FROM node:22-alpine

WORKDIR /app

# Copy package.json and package-lock.json first for better layer caching
COPY package*.json ./
COPY patches ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build the application
RUN npm run build:only

# Expose the API port
EXPOSE 3420

# Create a non-root user for security
RUN adduser --disabled-password --gecos "" argus
RUN chown -R argus:argus /app
USER argus

# Default command to run the server
CMD ["node", "dist/server/serve.js"]
