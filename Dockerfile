FROM node:20-alpine
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["node", "server.mjs"]
