FROM node:18-alpine

# bcrypt requires build tools; openssl for cert generation; mysql-client for backup/restore
RUN apk add --no-cache python3 make g++ openssl mysql-client

WORKDIR /app

COPY package.json ./

# Install fresh (no lockfile) to get platform-correct native modules
RUN npm install --production

COPY src ./src
COPY database ./database

EXPOSE 3443

# Generate self-signed certs at startup if not mounted
CMD ["sh", "-c", "if [ ! -f /app/certs/server.key ]; then mkdir -p /app/certs && openssl req -x509 -newkey rsa:2048 -keyout /app/certs/server.key -out /app/certs/server.crt -days 365 -nodes -subj '/CN=localhost' 2>/dev/null && echo '[CERTS] Generated self-signed certificates'; fi && NODE_ENV=production node src/index.js"]
