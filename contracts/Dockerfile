FROM node:22-slim
WORKDIR /repo/contracts
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx hardhat compile
EXPOSE 8545
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]
