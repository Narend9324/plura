import { zValidator } from "@hono/zod-validator";
import { prisma } from "@plura/db";
import { Hono } from "hono";
import { workspaceSchema } from "@repo/types";
import { auth } from "@plura/auth";

const app = new Hono()
  .get("/all", async (c) => {
    const cursor = c.req.query("cursor");
    const take = c.req.query("take");
    if (!c.req.url.includes("?cursor=")) {
      return c.redirect("?cursor=");
    }

    const workspaces = await prisma.workspace.findMany({
      take: parseInt(take!) || 10,
      skip: 1,
      cursor: cursor
        ? {
            id: cursor,
          }
        : undefined,
      orderBy: {
        createdAt: "asc",
      },
    });
    const nextCursor =
      workspaces.length > 0 ? workspaces[workspaces.length - 1].id : null;
    return c.json(
      {
        workspaces,
        nextCursor,
      },
      200,
    );
  })
  .get("/:id", async (c) => {
    const workspaceId = c.req.param("id");
    if (!workspaceId) {
      return c.json({ message: "missing workspace id" }, 400);
    }
    const workspace = await prisma.workspace.findUnique({
      where: {
        id: workspaceId,
      },
    });
    if (!workspace) {
      return c.json({ message: "workspace not found" }, 404);
    }
    return c.json(
      {
        workspace,
      },
      200,
    );
  })
  .get("/user/:userId", async (c) => {
    const userId = c.req.param("userId");
    if (!userId) {
      return c.json({ message: "missing user id" }, 400);
    }
    const workspaces = await prisma.workspace.findMany({
      where: {
        userId: userId,
      },
    });
    if (workspaces.length === 0) {
      return c.json({ message: "workspaces not found" }, 404);
    }
    return c.json(
      {
        workspaces,
      },
      200,
    );
  })
  .post("/", zValidator("form", workspaceSchema), async (c) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    const userId = session?.user.id;
    const body = c.req.valid("form");

    if (!body) {
      return c.json({ message: "missing body" }, 400);
    }
    if (!userId) {
      return c.json({ message: "missing user id" }, 400);
    }
    const workspace = await prisma.workspace.create({
      data: {
        name: body.name,
        userId: userId,
      },
    });
    if (!workspace) {
      return c.json({ message: "failed to create workspace" }, 404);
    }
    return c.json(
      {
        workspace,
      },
      200,
    );
  })
  .delete("/:id", async (c) => {
    const workspaceId = c.req.param("id");
    if (!workspaceId) {
      return c.json({ message: "missing workspace id" }, 400);
    }
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session?.user.id) {
      return c.json({ message: "unauthorized" }, 401);
    }

    const existingWorkspace = await prisma.workspace.findUnique({
      where: {
        id: workspaceId,
        userId: session.user.id,
      },
    });
    if (!existingWorkspace) {
      return c.json({ message: "workspace not found" }, 404);
    }
    const workspace = await prisma.workspace.delete({
      where: {
        id: workspaceId,
        userId: session.user.id,
      },
    });
    return c.json(
      {
        deletedWorkspace: workspace,
      },
      200,
    );
  });

export default app;
