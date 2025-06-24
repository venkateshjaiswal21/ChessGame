const express = require("express")
const socket = require("socket.io")
const http = require("http")
const { Chess } = require("chess.js")
const path = require("path")

const app = express();
const server = http.createServer(app);

const io = socket(server)

let chess = new Chess(); 
let players = {};
let currentPlayer = "w";
// Track move history for undo
let moveHistory = [];
// Track redoable moves
let redoHistory = [];
// Track last move player to enable undo for them
let lastMovePlayer = null;
// Track player who can redo
let canRedoPlayer = null;
// Keep track of spectator positions
let spectatorPositions = {};

app.set('views', path.join(__dirname, 'views'));
app.set("view engine","ejs");
app.use(express.static(path.join(__dirname,"public")));

app.get("/", (req,res) => {
    res.render("index", {title: "Chess Game"});
});

// Function to reset the game
function resetGame() {
    chess = new Chess();
    moveHistory = [];
    redoHistory = [];
    lastMovePlayer = null;
    canRedoPlayer = null;
    spectatorPositions = {};
    currentPlayer = "w";
    
    // Notify all clients of the reset
    io.emit("gameReset");
    io.emit("boardState", chess.fen());
    io.emit("moveHistory", moveHistory);
    io.emit("moveHistoryLength", 0);
}

io.on("connection", function(uniquesocket){
    console.log("connected with id:", uniquesocket.id);

    if(!players.white){
        players.white = uniquesocket.id;
        uniquesocket.emit("playerRole","w");
        console.log("White player connected:", uniquesocket.id);
    }
    else if(!players.black){
        players.black = uniquesocket.id;
        uniquesocket.emit("playerRole","b");
        console.log("Black player connected:", uniquesocket.id);
    }
    else{
        uniquesocket.emit("spectatorRole");
        // Initialize spectator to view the current state
        spectatorPositions[uniquesocket.id] = moveHistory.length; 
        uniquesocket.emit("spectatorPosition", moveHistory.length);
        console.log("Spectator connected:", uniquesocket.id);
    }

    // Send initial board state and history to new connections
    uniquesocket.emit("boardState", chess.fen());
    uniquesocket.emit("moveHistory", moveHistory);
    uniquesocket.emit("moveHistoryLength", moveHistory.length);
    
    // Send the undo/redo permissions
    uniquesocket.emit("canUndo", uniquesocket.id === lastMovePlayer);
    uniquesocket.emit("canRedo", uniquesocket.id === canRedoPlayer);

    uniquesocket.on("disconnect", function(){
        console.log("Client disconnected:", uniquesocket.id);
        
        // Check if a player disconnected
        let playerDisconnected = false;
        
        if(uniquesocket.id === players.white){
            console.log("White player disconnected");
            delete players.white;
            playerDisconnected = true;
        }
        else if(uniquesocket.id === players.black){
            console.log("Black player disconnected");
            delete players.black;
            playerDisconnected = true;
        }
        
        // Remove spectator position data
        if(spectatorPositions[uniquesocket.id]) {
            console.log("Spectator disconnected");
            delete spectatorPositions[uniquesocket.id];
        }
        
        // Reset the game if any player disconnects
        if(playerDisconnected) {
            console.log("Resetting game due to player disconnect");
            resetGame();
        }
    })

    uniquesocket.on("move",(move)=>{
        try{
            if(chess.turn() === 'w' && uniquesocket.id !== players.white){
                return;
            }
            if(chess.turn() === 'b' && uniquesocket.id !== players.black){
                return;
            }

            const result = chess.move(move);
            if(result){
                // Clear redo history when a new move is made
                redoHistory = [];
                canRedoPlayer = null;
                
                // Store the move in history
                moveHistory.push({
                    move: move,
                    fen: chess.fen(),
                    player: uniquesocket.id
                });
                
                // Update who made the last move - they can undo
                lastMovePlayer = uniquesocket.id;
                
                currentPlayer = chess.turn();
                io.emit("move", move);
                io.emit("boardState", chess.fen());
                io.emit("moveHistory", moveHistory);
                io.emit("moveHistoryLength", moveHistory.length);
                
                // Update undo/redo permissions
                io.emit("canUndo", false);
                io.emit("canRedo", false);
                uniquesocket.emit("canUndo", true);
                
                // Update all spectators to the latest position
                for (let specId in spectatorPositions) {
                    spectatorPositions[specId] = moveHistory.length;
                    io.to(specId).emit("spectatorPosition", moveHistory.length);
                }
                
                // Check for game over conditions
                if (chess.isGameOver()) {
                    let result = "";
                    if (chess.isCheckmate()) {
                        result = chess.turn() === 'w' ? "Black wins by checkmate!" : "White wins by checkmate!";
                    } else if (chess.isDraw()) {
                        result = "Game ended in a draw!";
                    } else if (chess.isStalemate()) {
                        result = "Game ended in stalemate!";
                    } else if (chess.isThreefoldRepetition()) {
                        result = "Game drawn by threefold repetition!";
                    } else if (chess.isInsufficientMaterial()) {
                        result = "Game drawn due to insufficient material!";
                    }
                    io.emit("gameOver", result);
                }
            }
            else{
                console.log("Invalid move: ", move)
                uniquesocket.emit("invalidMove", move);
            }
        }
        catch(err){
            console.log(err);
            uniquesocket.emit("Invalid move: ", move);
        }
    });

    // Handle undo move requests
    uniquesocket.on("undoMove", () => {
        // Check if there are moves to undo
        if (moveHistory.length === 0) {
            uniquesocket.emit("undoFailed", "No moves to undo");
            return;
        }

        // Check if the requesting player is allowed to undo (last player who moved)
        if (uniquesocket.id !== lastMovePlayer) {
            uniquesocket.emit("undoFailed", "You can only undo your own move");
            return;
        }

        // Move the last move from moveHistory to redoHistory
        const lastMove = moveHistory.pop();
        redoHistory.push(lastMove);
        
        // Set the player who can redo (same as the one who undid)
        canRedoPlayer = uniquesocket.id;
        
        if (moveHistory.length === 0) {
            // Reset to starting position
            chess.reset();
            lastMovePlayer = null; // No last move player after reset
        } else {
            // Load the previous position
            chess.load(moveHistory[moveHistory.length - 1].fen);
            
            // Update the last move player to the player who made the previous move
            lastMovePlayer = moveHistory[moveHistory.length - 1].player;
        }

        currentPlayer = chess.turn();
        io.emit("boardState", chess.fen());
        io.emit("moveHistory", moveHistory);
        io.emit("moveHistoryLength", moveHistory.length);
        io.emit("moveUndone");
        
        // Update undo permissions
        io.emit("canUndo", false);
        if (lastMovePlayer) {
            io.to(lastMovePlayer).emit("canUndo", true);
        }
        
        // Update redo permissions
        io.emit("canRedo", false);
        uniquesocket.emit("canRedo", true);
        
        // Update all spectators to the latest position
        for (let specId in spectatorPositions) {
            spectatorPositions[specId] = moveHistory.length;
            io.to(specId).emit("spectatorPosition", moveHistory.length);
        }
    });
    
    // Handle redo move requests
    uniquesocket.on("redoMove", () => {
        // Check if there are moves to redo
        if (redoHistory.length === 0) {
            uniquesocket.emit("redoFailed", "No moves to redo");
            return;
        }

        // Check if the requesting player is allowed to redo
        if (uniquesocket.id !== canRedoPlayer) {
            uniquesocket.emit("redoFailed", "You cannot redo at this moment");
            return;
        }

        // Move the last redo move back to the move history
        const moveToRedo = redoHistory.pop();
        moveHistory.push(moveToRedo);
        
        // Load the redone position
        chess.load(moveToRedo.fen);
        
        // Update the last move player
        lastMovePlayer = moveToRedo.player;
        
        // If no more redos, clear the canRedoPlayer
        if (redoHistory.length === 0) {
            canRedoPlayer = null;
        }

        currentPlayer = chess.turn();
        io.emit("boardState", chess.fen());
        io.emit("moveHistory", moveHistory);
        io.emit("moveHistoryLength", moveHistory.length);
        io.emit("moveRedone");
        
        // Update undo/redo permissions
        io.emit("canUndo", false);
        io.emit("canRedo", false);
        
        if (lastMovePlayer) {
            io.to(lastMovePlayer).emit("canUndo", true);
        }
        
        if (redoHistory.length > 0 && canRedoPlayer) {
            io.to(canRedoPlayer).emit("canRedo", true);
        }
        
        // Update all spectators to the latest position
        for (let specId in spectatorPositions) {
            spectatorPositions[specId] = moveHistory.length;
            io.to(specId).emit("spectatorPosition", moveHistory.length);
        }
    });
    
    // Handle spectator navigation requests
    uniquesocket.on("spectatorMovePrev", () => {
        // Only spectators can navigate through history this way
        if (uniquesocket.id === players.white || uniquesocket.id === players.black) {
            return;
        }
        
        // Get current position and make sure we're not at the beginning
        const currentPos = spectatorPositions[uniquesocket.id] || moveHistory.length;
        if (currentPos <= 0) {
            return;
        }
        
        // Move one step back in history
        const newPos = currentPos - 1;
        spectatorPositions[uniquesocket.id] = newPos;
        
        // Send the board state at that position
        if (newPos === 0) {
            // Initial board state
            const initialBoard = new Chess();
            uniquesocket.emit("spectatorBoardState", initialBoard.fen());
        } else {
            uniquesocket.emit("spectatorBoardState", moveHistory[newPos - 1].fen);
        }
        
        uniquesocket.emit("spectatorPosition", newPos);
    });
    
    uniquesocket.on("spectatorMoveNext", () => {
        // Only spectators can navigate through history this way
        if (uniquesocket.id === players.white || uniquesocket.id === players.black) {
            return;
        }
        
        // Get current position and make sure we're not at the end
        const currentPos = spectatorPositions[uniquesocket.id];
        if (currentPos === undefined || currentPos >= moveHistory.length) {
            return;
        }
        
        // Move one step forward in history
        const newPos = currentPos + 1;
        spectatorPositions[uniquesocket.id] = newPos;
        
        // Send the board state at that position
        uniquesocket.emit("spectatorBoardState", moveHistory[newPos - 1].fen);
        uniquesocket.emit("spectatorPosition", newPos);
    });
    
    uniquesocket.on("spectatorJumpToLatest", () => {
        // Only spectators can navigate through history this way
        if (uniquesocket.id === players.white || uniquesocket.id === players.black) {
            return;
        }
        
        // Jump to the latest move
        spectatorPositions[uniquesocket.id] = moveHistory.length;
        
        // Send the current board state
        uniquesocket.emit("spectatorBoardState", chess.fen());
        uniquesocket.emit("spectatorPosition", moveHistory.length);
    });
    
    // New handler for forced game reset
    uniquesocket.on("resetGame", () => {
        // Only white player can reset the game (you can modify this permission as needed)
        if (uniquesocket.id === players.white) {
            resetGame();
        }
    });
});

server.listen(8080, function (){
    console.log("listening on port 8080");
});