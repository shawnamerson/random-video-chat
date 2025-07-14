FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Expose the port your server listens on
EXPOSE 4000

# Launch the signaling server
CMD ["node", "server.js"]
