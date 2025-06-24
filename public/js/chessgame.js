const socket = io()

let chess = new Chess();
const boardElement = document.querySelector(".chessboard");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const resetButton = document.getElementById("resetButton");
const moveHistory = document.getElementById("moveHistory");
const playerElement = document.getElementById("player");
const gameStatusElement = document.getElementById("gameStatus");
const spectatorControls = document.getElementById("spectatorControls");
const prevMoveButton = document.getElementById("prevMoveBtn");
const nextMoveButton = document.getElementById("nextMoveBtn");
const latestMoveButton = document.getElementById("latestMoveBtn");
const movePositionDisplay = document.getElementById("movePosition");

let draggedPiece = null;
let sourceSquare = null;
let playerRole = null;
let moveHistoryData = [];
let canUndoMove = false;
let canRedoMove = false;
let currentMoveIndex = 0;
let totalMoves = 0;
let isSpectator = false;

// Handle undo button click
undoButton.addEventListener("click", () => {
    socket.emit("undoMove");
});

// Handle redo button click
redoButton.addEventListener("click", () => {
    socket.emit("redoMove");
});

// Handle reset button click (only visible to white player)
if (resetButton) {
    resetButton.addEventListener("click", () => {
        socket.emit("resetGame");
    });
}

// Handle spectator navigation buttons
prevMoveButton.addEventListener("click", () => {
    socket.emit("spectatorMovePrev");
});

nextMoveButton.addEventListener("click", () => {
    socket.emit("spectatorMoveNext");
});

latestMoveButton.addEventListener("click", () => {
    socket.emit("spectatorJumpToLatest");
});

// Function to update UI controls
const updateUIControls = () => {
    // Update move history display
    if (moveHistoryData.length > 0) {
        const lastMove = moveHistoryData[moveHistoryData.length - 1].move;
        moveHistory.textContent = `Last move: ${lastMove.from}-${lastMove.to}`;
    } else {
        moveHistory.textContent = "No moves yet";
    }
    
    // Player controls - show/hide undo/redo buttons based on permission
    undoButton.style.display = canUndoMove ? "block" : "none";
    redoButton.style.display = canRedoMove ? "block" : "none";
    
    // Show reset button only for white player
    if (resetButton) {
        resetButton.style.display = playerRole === 'w' ? "block" : "none";
    }
    
    // Spectator controls - only show for spectators
    spectatorControls.style.display = isSpectator ? "flex" : "none";
    
    // Update move position display for spectators
    if (isSpectator) {
        movePositionDisplay.textContent = `Move: ${currentMoveIndex} / ${totalMoves}`;
        
        // Enable/disable navigation buttons based on position
        prevMoveButton.disabled = currentMoveIndex <= 0;
        nextMoveButton.disabled = currentMoveIndex >= totalMoves;
        latestMoveButton.disabled = currentMoveIndex >= totalMoves;
    }
};

const renderBoard = () => {
    const board = chess.board();
    boardElement.innerHTML = "";
    board.forEach((row, rowIndex) => {
        row.forEach((square, squareIndex) => {
            const squareElement = document.createElement("div");
            squareElement.classList.add(
                "square",
                (rowIndex + squareIndex) % 2 == 0 ? "light" : "dark"
            );

            squareElement.dataset.row = rowIndex;
            squareElement.dataset.column = squareIndex;

            if (square) {
                const pieceElement = document.createElement("div");
                pieceElement.classList.add(
                    "piece",
                    square.color === "w" ? "white" : "black"
                );
                pieceElement.innerText = getPieceUnicode(square);
                
                // Only allow dragging for players and only their pieces
                pieceElement.draggable = !isSpectator && playerRole === square.color;

                squareElement.addEventListener("dragstart", (e) => {
                    // Only allow dragging for players and only their pieces
                    if (isSpectator || playerRole !== square.color) {
                        e.preventDefault();
                        return;
                    }
                    
                    draggedPiece = pieceElement;
                    sourceSquare = { row: rowIndex, col: squareIndex };
                    e.dataTransfer.setData("text/plain", "");
                });

                squareElement.addEventListener("dragend", (e) => {
                    draggedPiece = null;
                    sourceSquare = null;
                })

                squareElement.appendChild(pieceElement);
            };

            squareElement.addEventListener("dragover", function (e) {
                e.preventDefault();
            });

            squareElement.addEventListener("drop", (e) => {
                e.preventDefault();
                
                // Don't allow spectators to move pieces
                if (isSpectator) {
                    return;
                }
                
                if (draggedPiece) {
                    let targetElement = e.target;
                    if (!targetElement.classList.contains('square')) {
                        targetElement = targetElement.parentElement;
                    }

                    const targetSource = {
                        row: parseInt(targetElement.dataset.row),
                        col: parseInt(targetElement.dataset.column)
                    }

                    handleMove(sourceSquare, targetSource);
                }
            })
            boardElement.appendChild(squareElement);
        })
    })

    if (playerRole === 'b') {
        boardElement.classList.add('flipped');
    }
    else {
        boardElement.classList.remove('flipped');
    }

    // Update player display
    if (isSpectator) {
        playerElement.textContent = `You are a spectator viewing move ${currentMoveIndex} of ${totalMoves}`;
    } else {
        playerElement.textContent = `You are playing as: ${playerRole === 'w' ? 'White' : 'Black'}`;
        playerElement.textContent += ` | Current turn: ${chess.turn() === 'w' ? 'White' : 'Black'}`;
    }
    
    // Update game status
    if (gameStatusElement) {
        if (chess.isCheckmate()) {
            gameStatusElement.textContent = chess.turn() === 'w' ? "Black wins by checkmate!" : "White wins by checkmate!";
        } else if (chess.isDraw()) {
            gameStatusElement.textContent = "Game ended in a draw!";
        } else if (chess.isCheck()) {
            gameStatusElement.textContent = `${chess.turn() === 'w' ? 'White' : 'Black'} is in check!`;
        } else {
            gameStatusElement.textContent = "";
        }
    }
    
    // Update UI controls
    updateUIControls();
};

const handleMove = (source, target) => {
    const sourceSquare = String.fromCharCode(97 + source.col) + (8 - source.row);
    const targetSquare = String.fromCharCode(97 + target.col) + (8 - target.row);
    const move = {
        from: sourceSquare,
        to: targetSquare,
        promotion: "q" // always promote to a queen for simplicity
    };
    socket.emit("move", move);
};

const getPieceUnicode = (piece) => {
    const unicodePieces = {
        p: '♙', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚', // Black pieces
        P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔'  // White pieces
    };

    return unicodePieces[piece.type] || '';
};

// Connection handler to request latest state on reconnect
socket.on("connect", function() {
    console.log("Connected to server");
    // If we were a spectator before, request the latest state
    if (isSpectator) {
        setTimeout(() => {
            socket.emit("spectatorJumpToLatest");
        }, 100);
    }
});

socket.on("playerRole", function (role) {
    playerRole = role;
    isSpectator = false;
    renderBoard();
});

socket.on("spectatorRole", function () {
    playerRole = null;
    isSpectator = true;
    renderBoard();
});

socket.on("boardState", function (fen) {
    chess.load(fen);
    renderBoard();
});

socket.on("spectatorBoardState", function (fen) {
    // Only update the board for spectator views
    if (isSpectator) {
        chess.load(fen);
        renderBoard();
    }
});

socket.on("moveHistory", function (history) {
    moveHistoryData = history;
    updateUIControls();
});

socket.on("moveHistoryLength", function (length) {
    totalMoves = length;
    if (isSpectator) {
        updateUIControls();
    }
});

socket.on("spectatorPosition", function (position) {
    if (isSpectator) {
        currentMoveIndex = position;
        updateUIControls();
    }
});

socket.on("canUndo", function (canUndo) {
    canUndoMove = canUndo;
    updateUIControls();
});

socket.on("canRedo", function (canRedo) {
    canRedoMove = canRedo;
    updateUIControls();
});

socket.on("move", function (data) {
    const moveResult = chess.move(data);
    if (moveResult) {
        moveHistory.textContent = `Move: ${data.from}-${data.to}`;
    } else {
        moveHistory.textContent = 'Invalid move';
    }
    renderBoard();
});

socket.on("moveUndone", function () {
    renderBoard();
});

socket.on("moveRedone", function () {
    renderBoard();
});

socket.on("undoFailed", function (message) {
    alert("Undo failed: " + message);
});

socket.on("redoFailed", function (message) {
    alert("Redo failed: " + message);
});

// New event for game over notification
socket.on("gameOver", function(result) {
    if (gameStatusElement) {
        gameStatusElement.textContent = result;
    } else {
        alert(result);
    }
});

// New event for game reset
socket.on("gameReset", function() {
    console.log("Game has been reset");
    chess = new Chess(); // Reset the local chess instance
    moveHistoryData = [];
    currentMoveIndex = 0;
    totalMoves = 0;
    
    // Reset the board display
    renderBoard();
    
    if (gameStatusElement) {
        gameStatusElement.textContent = "Game has been reset";
        setTimeout(() => {
            gameStatusElement.textContent = "";
        }, 3000);
    }
});

// Initialize the board
renderBoard();