FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dist/front ./dist/front
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/front/server/server.mjs"]
