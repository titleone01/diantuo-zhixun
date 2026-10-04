import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { desc } from "drizzle-orm";

// Public signup is disabled. Invitation acceptance creates user and credential
// rows in one D1 transaction; Better Auth verifies passwords and owns sessions.
export const user = sqliteTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false), image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  username: text("username").notNull().unique(), displayUsername: text("displayUsername"),
  role: text("role").notNull().default("member"), bio: text("bio").notNull().default(""), disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
});
export const session = sqliteTable("session", {
  id: text("id").primaryKey(), expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(), token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ipAddress"), userAgent: text("userAgent"), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
}, table => [index("session_user").on(table.userId)]);
export const account = sqliteTable("account", {
  id: text("id").primaryKey(), accountId: text("accountId").notNull(), providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"), refreshToken: text("refreshToken"), idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }), refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
  scope: text("scope"), password: text("password"), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, table => [uniqueIndex("account_provider_account").on(table.providerId, table.accountId)]);
export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, table => [index("verification_identifier").on(table.identifier)]);
export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(), tokenHash: text("tokenHash").notNull().unique(), createdBy: text("createdBy").notNull().references(() => user.id),
  createdAt: integer("createdAt").notNull(), expiresAt: integer("expiresAt").notNull(), consumedBy: text("consumedBy").references(() => user.id), consumedAt: integer("consumedAt"),
});
export const circuits = sqliteTable("circuits", {
  id: text("id").primaryKey(), ownerId: text("ownerId").notNull().references(() => user.id), title: text("title").notNull(), document: text("document").notNull(),
  revision: integer("revision").notNull().default(1), writeId: text("writeId").notNull().default(""), forkedFrom: text("forkedFrom"), createdAt: integer("createdAt").notNull(), updatedAt: integer("updatedAt").notNull(),
}, table => [index("circuits_owner").on(table.ownerId, desc(table.updatedAt))]);
export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(), circuitId: text("circuitId").notNull(), ownerId: text("ownerId").notNull().references(() => user.id), title: text("title").notNull(),
  description: text("description").notNull().default(""), document: text("document").notNull(), sourceRevision: integer("sourceRevision").notNull(), createdAt: integer("createdAt").notNull(),
}, table => [uniqueIndex("publication_circuit_revision").on(table.circuitId, table.sourceRevision), index("publications_created").on(desc(table.createdAt))]);
export const reactions = sqliteTable("reactions", {
  userId: text("userId").notNull().references(() => user.id), publicationId: text("publicationId").notNull().references(() => publications.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), createdAt: integer("createdAt").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.publicationId, table.kind] }), index("reactions_publication_kind").on(table.publicationId, table.kind)]);
export const media = sqliteTable("media", {
  id: text("id").primaryKey(), ownerId: text("ownerId").notNull().references(() => user.id), objectKey: text("objectKey").notNull().unique(), name: text("name").notNull(),
  type: text("type").notNull(), size: integer("size").notNull(), createdAt: integer("createdAt").notNull(),
});
export const circuitMedia = sqliteTable("circuit_media", {
  circuitId: text("circuitId").notNull().references(() => circuits.id, { onDelete: "cascade" }), mediaId: text("mediaId").notNull().references(() => media.id),
}, table => [primaryKey({ columns: [table.circuitId, table.mediaId] })]);
export const publicationMedia = sqliteTable("publication_media", {
  publicationId: text("publicationId").notNull().references(() => publications.id, { onDelete: "cascade" }), mediaId: text("mediaId").notNull().references(() => media.id),
}, table => [primaryKey({ columns: [table.publicationId, table.mediaId] }), index("publication_media_media").on(table.mediaId)]);
export const assessments = sqliteTable("assessments", {
  id: text("id").primaryKey(), userId: text("userId").notNull().references(() => user.id), lessonId: text("lessonId").notNull(), documentHash: text("documentHash").notNull(),
  result: text("result").notNull(), createdAt: integer("createdAt").notNull(),
}, table => [index("assessments_user").on(table.userId, desc(table.createdAt))]);
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(), expiresAt: integer("expiresAt").notNull(),
});
export const trainingDrawings = sqliteTable("training_drawings", {
  projectId: text("projectId").notNull(), kind: text("kind", { enum: ["schematic", "layout"] }).notNull().default("schematic"),
  title: text("title").notNull(), mediaId: text("mediaId").notNull().references(() => media.id),
  updatedBy: text("updatedBy").notNull().references(() => user.id), updatedAt: integer("updatedAt").notNull(),
  version: text("version").notNull().default(""),
}, table => [primaryKey({ columns: [table.projectId, table.kind] }), index("training_drawings_media").on(table.mediaId)]);
