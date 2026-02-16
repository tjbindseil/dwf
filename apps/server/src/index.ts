import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildServer();

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
