FROM node:22-alpine

WORKDIR /app

# Copy package.json and package-lock.json first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the application
RUN npm run build:only

# Expose the API port
EXPOSE 3420

# Default command to run the server
CMD ["node", "dist/server/serve.js"]
