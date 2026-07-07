# Cirkel — kører hele appen (frontend + Express/AI-backend) som ét web-system.
# Bygger og kører din app uændret. Port 3000.
FROM node:22-slim

WORKDIR /app

# Installer afhængigheder (cache-venligt)
COPY package*.json ./
RUN npm ci

# Kopiér resten og byg produktionsversionen (vite + esbuild)
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Starter Express-serveren der serverer SPA + /api (Gemini)
CMD ["node", "dist/server.cjs"]
