import { Hono } from "hono";
import { prisma } from "@plura/db";
import { auth } from "@plura/auth";
import { cache } from "@plura/cache"; // Assuming a Redis cache instance

const app = new Hono()
  // Route to get the currently logged-in user
  .get("/self", async (c) => {
    try {
      const currentUser = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      if (!currentUser) {
        return c.json(
          {
            message: "Not logged in",
            status: 400,
          },
          400
        );
      }

      const user = await prisma.user.findUnique({
        where: {
          id: currentUser.user.id,
        },
      });

      if (!user) {
        return c.json(
          {
            message: "User not found",
            status: 404,
          },
          404
        );
      }

      return c.json({ user }, 200);
    } catch (err) {
      console.error("Error in /self endpoint:", err);
      return c.json({ error: "Something went wrong" }, 500);
    }
  })

  // Route to get all users (with pagination)
  .get("/all", async (c) => {
    const cursor = c.req.query("cursor"); // Cursor for pagination (user id)
    const take = parseInt(c.req.query("take") || "10"); // Default take to 10 if not provided
    const cacheKey = "users:cache"; // Single cache key for all user data

    try {
      // Check if the data is in the cache
      const cachedLength = await cache.llen(cacheKey); // Check if the list exists and get its length
      let users = [];

      // If cached data doesn't exist, fetch from the database
      if (!cachedLength || cachedLength === 0) {
        users = await prisma.user.findMany({
          take,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: { id: "asc" }, // Ensure a consistent order for pagination
        });

        // Cache each user in the Redis list (using RPUSH to append each user)
        for (const user of users) {
          const userString = JSON.stringify(user); // Ensure user is stringified
          console.log("Storing user in cache as string:", userString); // Debugging statement
          await cache.rpush(cacheKey, userString); // Store each user as a JSON string
        }

        // Optional: Set a TTL for the cache (e.g., 10 minutes)
        await cache.expire(cacheKey, 600); // 10 minutes
      }

      // If users exist in cache, fetch from the Redis list
      if (!users.length) {
        // If we have a cursor, find the index of the cursor and continue from there
        let startIndex = 0;
        if (cursor) {
          // Scan the list to find the cursor index
          const allUsers = await cache.lrange(cacheKey, 0, -1); // Get the entire list to search the cursor
          console.log("All users from cache (before parsing):", allUsers); // Debugging statement
          const cursorIndex = allUsers.findIndex(
            (user) => JSON.parse(user).id === cursor
          );
          startIndex = cursorIndex + 1; // Start after the cursor
        }

        // Fetch the paginated users from Redis
        const rawUsers = await cache.lrange(
          cacheKey,
          startIndex,
          startIndex + take - 1
        );
        console.log("Raw users from cache (before parsing):", rawUsers); // Debugging statement

        users = rawUsers
          .map((user) => {
            // Log the user before parsing to ensure it's a string
            if (typeof user !== "string") {
              console.error("User is not a string:", user);
            }
            try {
              return JSON.parse(user); // Ensure proper parsing
            } catch (err) {
              console.error("Error parsing user from Redis:", err, { user });
              return null; // Ensure null is returned for invalid JSON
            }
          })
          .filter((user) => user !== null); // Filter out any users that failed to parse
      }

      // Determine the next cursor for pagination
      const nextCursor =
        users.length === take ? users[users.length - 1].id : null;

      // Prepare the response
      const response = {
        nextCursor, // Cursor for the next page
        users, // The current page of users
      };

      // Serve the response
      return c.json(response, 200);
    } catch (err) {
      console.error("Error in /all endpoint:", err);
      return c.json({ error: "Something went wrong" }, 500);
    }
  })

  // Route to get user by ID
  .get("/:id", async (c) => {
    const userId = c.req.param("id");
    if (!userId) {
      return c.json({
        message: "user id is required",
        status: 400,
      });
    }
    try {
      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        return c.json(
          {
            message: "User not found",
            status: 404,
          },
          404
        );
      }

      return c.json(
        {
          user,
        },
        200
      );
    } catch (err) {
      console.error("Error fetching user by ID:", err); // Log the error
      return c.json({ error: "Something went wrong" }, 500);
    }
  });

export default app;
