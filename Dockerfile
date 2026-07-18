# Repotector — containerized CLI + MCP server.
# The guarded repo is MOUNTED at /repo; the image never contains user code.
#
#   docker run --rm -v "$PWD:/repo" ghcr.io/dir-ai/repotector init
#   docker run --rm -v "$PWD:/repo" ghcr.io/dir-ai/repotector gates
#   docker run -i --rm -v "$PWD:/repo" ghcr.io/dir-ai/repotector mcp   # stdio MCP
FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY bin ./bin
COPY src ./src
COPY templates ./templates
COPY intent.schema.json server.json LICENSE SECURITY.md README.md ./

# A mounted repo is owned by the host uid — git refuses to read it without this.
RUN git config --global --add safe.directory '*'

WORKDIR /repo
ENTRYPOINT ["node", "/app/bin/psx-repotector.mjs"]
CMD ["help"]
