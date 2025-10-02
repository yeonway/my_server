// public/js/main.js
let socket;
const chatDiv = document.getElementById("chat");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput");
let token = null;

async function initChat() {
  token = localStorage.getItem("token");
  if (!token && window.ensureAuthToken) {
    token = await window.ensureAuthToken();
  }
  if (!token) {
    alert("로그인이 필요합니다.");
    window.location.href = "/login.html";
    return;
  }

  joinBtn.addEventListener("click", () => {
    const room = roomInput.value.trim();
    if (!room) {
      alert("방 이름을 입력하세요!");
      return;
    }

    if (socket) socket.disconnect();
    socket = io({ auth: { token } });

    socket.on("connect", () => {
      socket.emit("joinRoom", room);
    });

    socket.on("previousMessages", (messages) => {
      chatDiv.innerHTML = "";
      messages.forEach(msg => {
        const div = document.createElement("div");
        div.textContent = `[${new Date(msg.time).toLocaleTimeString()}] ${msg.user}: ${msg.message}`;
        chatDiv.appendChild(div);
      });
      chatDiv.scrollTop = chatDiv.scrollHeight;
    });

    socket.on("chatMessage", (msg) => {
      const div = document.createElement("div");
      div.textContent = `[${new Date(msg.time).toLocaleTimeString()}] ${msg.user}: ${msg.message}`;
      chatDiv.appendChild(div);
      chatDiv.scrollTop = chatDiv.scrollHeight;
    });
  });

  sendBtn.addEventListener("click", () => {
    if (!socket) {
      alert("먼저 방에 참여하세요!");
      return;
    }
    const room = roomInput.value.trim();
    const message = messageInput.value.trim();
    if (!message) return;

    socket.emit("chatMessage", { room, message });
    messageInput.value = "";
  });
}

initChat();
