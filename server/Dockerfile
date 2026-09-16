# Forge Engine: build the game and serve it with the relay server in one image.
#   docker build -f server/Dockerfile -t forge-game .
#   docker run -p 8080:8080 forge-game
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC=/app/dist
COPY server/package.json server/index.js ./server/
RUN cd server && npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
