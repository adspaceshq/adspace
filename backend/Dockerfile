FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY dist ./dist
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
