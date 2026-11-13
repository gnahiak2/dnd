import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import {
  ClientMessageSchema,
  CreateRoomRequestSchema,
  type ErrorCode,
  JoinRoomRequestSchema,
  type RoomInfo,
  type SeatResponse,
  type ServerMessage,
} from "@lanternkeep/protocol";
import type { DieRoller } from "@lanternkeep/rules";
import { SRD_ATTRIBUTION, type SrdDataset, loadSrd, parseCategory } from "@lanternkeep/srd-data";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { openDb } from "./db";
import { CommandError, HTTP_STATUS } from "./room/errors";
import { RoomManager, newId } from "./room/manager";
import type { Connection, Room } from "./room/room";
import { RoomStore } from "./room/store";
import { cryptoRoller } from "./roller";

export interface AppOptions {
  /** SQLite file, or ":memory:". */
  dbFile: string;
  roller?: DieRoller;
  srd?: SrdDataset;
  logger?: boolean;
  /** Built web client to serve, for single-process deployments. */
  webDist?: string;
  /** Requests per window per IP for creating and joining rooms. */
  seatRateLimit?: { max: number; windowMs: number };
  /** How long a socket may stay silent before its first hello. */
  helloTimeoutMs?: number;
}

export interface App {
  server: FastifyInstance;
  manager: RoomManager;
  close(): Promise<void>;
}

const WS_MAX_PAYLOAD = 64 * 1024;
const HEARTBEAT_MS = 30_000;
/** Per-connection command budget: a burst of 30, refilling at 10 per second. */
const COMMAND_BURST = 30;
const COMMAND_REFILL_PER_MS = 10 / 1000;

function sendError(reply: FastifyReply, code: ErrorCode, message: string): FastifyReply {
  return reply.status(HTTP_STATUS[code]).send({ error: { code, message } });
}

function describeIssues(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}

function fixedWindowLimiter(max: number, windowMs: number, now: () => number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      hits.set(key, { count: 1, resetAt: t + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

export async function buildApp(options: AppOptions): Promise<App> {
  const db = openDb(options.dbFile);
  const srd = options.srd ?? loadSrd();
  const manager = new RoomManager(new RoomStore(db), { roller: options.roller ?? cryptoRoller, srd, newId });
  const server = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 });
  const seatLimit = options.seatRateLimit ?? { max: 30, windowMs: 10 * 60_000 };
  const allowSeat = fixedWindowLimiter(seatLimit.max, seatLimit.windowMs, Date.now);

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof CommandError) return sendError(reply, error.code, error.message);
    if (error instanceof z.ZodError) return sendError(reply, "invalid", describeIssues(error));
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: "invalid", message: (error as Error).message } });
    }
    request.log.error(error);
    return sendError(reply, "internal", "Something went wrong on the server");
  });

  await server.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD } });

  // ---- rooms ----

  server.get("/api/health", () => ({ ok: true }));

  server.post("/api/rooms", (request, reply) => {
    if (!allowSeat(request.ip)) return sendError(reply, "rate_limited", "Too many rooms created from here; try again later");
    const body = CreateRoomRequestSchema.parse(request.body);
    const seat: SeatResponse = manager.create(body);
    return reply.status(201).send(seat);
  });

  server.get<{ Params: { roomId: string } }>("/api/rooms/:roomId", (request, reply) => {
    const room = manager.get(request.params.roomId);
    if (!room) return sendError(reply, "not_found", "No such room");
    const info: RoomInfo = {
      roomId: room.id,
      name: room.snapshot.name,
      playerCount: Object.keys(room.snapshot.players).length,
    };
    return info;
  });

  server.post<{ Params: { roomId: string } }>("/api/rooms/:roomId/join", (request, reply) => {
    if (!allowSeat(request.ip)) return sendError(reply, "rate_limited", "Too many joins from here; try again later");
    const body = JoinRoomRequestSchema.parse(request.body);
    const seat: SeatResponse = manager.join(request.params.roomId, body.displayName);
    return reply.status(201).send(seat);
  });

  // ---- SRD reference ----

  const SearchQuery = z.object({
    q: z.string().max(100).default(""),
    category: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  });

  server.get("/api/srd/attribution", () => ({ text: SRD_ATTRIBUTION, source: srd.manifest.source, commit: srd.manifest.commit }));
  server.get("/api/srd/categories", () => ({ categories: srd.categories() }));

  server.get("/api/srd/search", (request, reply) => {
    const query = SearchQuery.parse(request.query);
    const category = query.category ? parseCategory(query.category) : undefined;
    if (query.category && !category) return sendError(reply, "not_found", "No such SRD category");
    const searchOptions = category ? { category, limit: query.limit } : { limit: query.limit };
    return { results: srd.search(query.q, searchOptions) };
  });

  server.get<{ Params: { category: string } }>("/api/srd/:category", (request, reply) => {
    const category = parseCategory(request.params.category);
    if (!category) return sendError(reply, "not_found", "No such SRD category");
    return { results: srd.list(category) };
  });

  server.get<{ Params: { category: string; index: string } }>("/api/srd/:category/:index", (request, reply) => {
    const category = parseCategory(request.params.category);
    const record = category && srd.get(category, request.params.index);
    if (!category || !record) return sendError(reply, "not_found", "No such SRD entry");
    const hit = srd.list(category).find((h) => h.index === record.index);
    return { category, index: record.index, name: hit?.name ?? record.index, record };
  });

  // ---- live sync ----

  server.get<{ Querystring: { room?: string } }>("/ws", { websocket: true }, (socket, request) => {
    attachSocket(socket, request.query.room ?? "", manager, options.helloTimeoutMs ?? 10_000, (error) =>
      request.log.error(error),
    );
  });

  // ---- web client (optional) ----

  if (options.webDist && existsSync(options.webDist)) {
    await server.register(fastifyStatic, { root: options.webDist });
  }
  server.setNotFoundHandler((request, reply) => {
    const isPage = request.method === "GET" && !request.url.startsWith("/api/") && !request.url.startsWith("/ws");
    if (isPage && options.webDist && existsSync(options.webDist)) return reply.sendFile("index.html");
    return sendError(reply, "not_found", "Not found");
  });

  const sweep = setInterval(() => manager.evictIdle(), 60_000);
  sweep.unref();

  return {
    server,
    manager,
    async close() {
      clearInterval(sweep);
      await server.close();
      db.close();
    },
  };
}

function attachSocket(
  socket: WebSocket,
  roomId: string,
  manager: RoomManager,
  helloTimeoutMs: number,
  logError: (error: unknown) => void,
): void {
  let room: Room | undefined;
  let connection: Connection | undefined;
  let alive = true;
  let tokens = COMMAND_BURST;
  let refilledAt = Date.now();

  const send = (message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const fatal = (code: ErrorCode, message: string): void => {
    send({ type: "fatal", code, message });
    socket.close(1008, code);
  };

  const helloTimer = setTimeout(() => fatal("unauthorized", "No hello received"), helloTimeoutMs);
  const heartbeat = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, HEARTBEAT_MS);
  socket.on("pong", () => {
    alive = true;
  });

  socket.on("close", () => {
    clearTimeout(helloTimer);
    clearInterval(heartbeat);
    if (room && connection) room.disconnect(connection);
  });
  socket.on("error", logError);

  socket.on("message", (data, isBinary) => {
    if (isBinary) return fatal("invalid", "Binary frames are not supported");
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return fatal("invalid", "Message is not JSON");
    }
    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { type?: unknown; id?: unknown } | null)?.type === "command" ? (raw as { id?: unknown }).id : undefined;
      if (connection && typeof id === "string" && id.length <= 64) {
        return send({ type: "reject", id, code: "invalid", message: describeIssues(parsed.error) });
      }
      return fatal("invalid", describeIssues(parsed.error));
    }
    const message = parsed.data;

    if (message.type === "hello") {
      if (connection) return fatal("invalid", "Already said hello");
      const found = manager.get(roomId);
      const player = found && manager.authenticate(roomId, message.token);
      if (!found || !player) return fatal("unauthorized", "This seat is not valid for this room");
      clearTimeout(helloTimer);
      room = found;
      connection = { playerId: player.id, send };
      room.connect(connection, message.afterSeq);
      return;
    }

    if (!room || !connection) return fatal("unauthorized", "Say hello first");

    const now = Date.now();
    tokens = Math.min(COMMAND_BURST, tokens + (now - refilledAt) * COMMAND_REFILL_PER_MS);
    refilledAt = now;
    if (tokens < 1) return send({ type: "reject", id: message.id, code: "rate_limited", message: "Slow down a little" });
    tokens -= 1;

    try {
      room.execute({ kind: "player", playerId: connection.playerId }, message.command);
      send({ type: "ack", id: message.id });
    } catch (error) {
      if (error instanceof CommandError) {
        return send({ type: "reject", id: message.id, code: error.code, message: error.message });
      }
      logError(error);
      send({ type: "reject", id: message.id, code: "internal", message: "Something went wrong on the server" });
    }
  });
}
