import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const useRemoteBindings = process.env.FLOWMAIL_REMOTE_BINDINGS === "1";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    define: {
      __FLOWMAIL_LOCAL_SETUP__: JSON.stringify(env.FLOWMAIL_LOCAL_SETUP === "1")
    },
    plugins: [
      ...(mode === "test" ? [] : [cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: useRemoteBindings }), tailwindcss(), reactRouter()]),
      tsconfigPaths()
    ]
  };
});
