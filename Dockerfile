# Use Node.js as base with Python support
FROM node:20-slim

# Install Python
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Create Python virtual environment
RUN python3 -m venv /app/venv

# Copy agent requirements and install Python dependencies
COPY agent/requirements.txt ./agent/
RUN . /app/venv/bin/activate && pip install --no-cache-dir -r agent/requirements.txt

# Copy all source code
COPY . .

# Make start script executable
RUN chmod +x /app/start.sh
RUN chmod +x /app/start-simple.sh

# Expose port
EXPOSE 3000

# Use ENTRYPOINT for Railway compatibility
ENTRYPOINT ["/app/start-simple.sh"]
