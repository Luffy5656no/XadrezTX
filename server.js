const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");
const os = require("os");

const app = express();
const server = http.createServer(app);

// Configuração do Socket.io com CORS ativado
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static("public"));

const rooms = {};

function generateRoomCode() {
    return Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();
}

// Função para obter o IP local dinamicamente
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === "IPv4" && !net.internal) {
                return net.address;
            }
        }
    }
    return "localhost";
}

io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);

    socket.on("createRoom", ({ playerName }) => {
        let roomCode;

        do {
            roomCode = generateRoomCode();
        } while (rooms[roomCode]);

        rooms[roomCode] = {
            game: new Chess(),
            players: [
                {
                    id: socket.id,
                    name: playerName || "Jogador 1",
                    color: "w"
                }
            ]
        };

        socket.join(roomCode);

        socket.emit("roomCreated", {
            roomCode: roomCode,
            color: "w"
        });

        console.log("Sala criada:", roomCode);
    });

    socket.on("joinRoom", ({ roomCode, playerName }) => {
        const code = (roomCode || "").trim().toUpperCase();
        const room = rooms[code];

        if (!room) {
            socket.emit("errorMessage", "Sala não encontrada! Verifique o código.");
            return;
        }

        if (room.players.length >= 2) {
            socket.emit("errorMessage", "Esta sala já está cheia!");
            return;
        }

        room.players.push({
            id: socket.id,
            name: playerName || "Jogador 2",
            color: "b"
        });

        socket.join(code);

        const whitePlayer = room.players.find((player) => player.color === "w");
        const blackPlayer = room.players.find((player) => player.color === "b");

        io.to(code).emit("gameStart", {
            roomCode: code,
            white: whitePlayer.name,
            black: blackPlayer.name,
            fen: room.game.fen()
        });

        console.log("Segundo jogador entrou na sala:", code);
    });

    socket.on("makeMove", ({ roomCode, move }) => {
        const code = (roomCode || "").trim().toUpperCase();
        const room = rooms[code];

        if (!room) {
            socket.emit("errorMessage", "A sala não existe mais.");
            return;
        }

        const player = room.players.find((roomPlayer) => roomPlayer.id === socket.id);

        if (!player) return;

        const currentTurn = room.game.turn();
        const wrongPlayer =
            (currentTurn === "w" && player.color !== "w") ||
            (currentTurn === "b" && player.color !== "b");

        if (wrongPlayer) {
            socket.emit("errorMessage", "Ainda não é a sua vez.");
            return;
        }

        try {
            const result = room.game.move({
                from: move.from,
                to: move.to,
                promotion: move.promotion || "q"
            });

            if (!result) {
                socket.emit("invalidMove");
                return;
            }

            io.to(code).emit("moveMade", {
                fen: room.game.fen(),
                lastMove: {
                    from: result.from,
                    to: result.to
                },
                turn: room.game.turn(),
                inCheck: room.game.isCheck(),
                isCheckmate: room.game.isCheckmate(),
                isDraw: room.game.isDraw(),
                isGameOver: room.game.isGameOver()
            });
        } catch (error) {
            console.log("Jogada inválida recebida:", move);
            socket.emit("invalidMove");
        }
    });

    socket.on("disconnect", () => {
        console.log("Cliente desconectado:", socket.id);

        for (const code in rooms) {
            const room = rooms[code];
            const playerIndex = room.players.findIndex((player) => player.id === socket.id);

            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);

                io.to(code).emit("playerLeft", "O outro jogador se desconectou.");

                if (room.players.length === 0) {
                    delete rooms[code];
                    console.log("Sala removida:", code);
                }

                break;
            }
        }
    });
});

// Porta dinâmica para hospedagem na nuvem
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
    const localIp = getLocalIp();
    console.log("\nServidor de xadrez rodando!");
    console.log(`Local: http://localhost:${PORT}`);
    console.log(`Rede local: http://${localIp}:${PORT}\n`);
});

server.on("error", (error) => {
    console.error("Erro ao iniciar o servidor:", error.message);
    if (error.code === "EADDRINUSE") {
        console.error(`A porta ${PORT} já está sendo utilizada.`);
    }
});