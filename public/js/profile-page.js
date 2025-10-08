(() => {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const elements = {
    backgroundWrapper: document.getElementById("backgroundWrapper"),
    backgroundPreview: document.getElementById("backgroundPreview"),
    backgroundInput: document.getElementById("backgroundInput"),
    backgroundUploadBtn: document.getElementById("backgroundUploadBtn"),
    backgroundRemoveBtn: document.getElementById("backgroundRemoveBtn"),
    avatarWrapper: document.getElementById("avatarWrapper"),
    avatarPlaceholder: document.getElementById("avatarPlaceholder"),
    profilePic: document.getElementById("profilePic"),
    profilePicInput: document.getElementById("profilePicInput"),
    avatarUploadBtn: document.getElementById("avatarUploadBtn"),
    avatarRemoveBtn: document.getElementById("avatarRemoveBtn"),
    displayName: document.getElementById("displayName"),
    introInput: document.getElementById("introInput"),
    statusMessageInput: document.getElementById("statusMessageInput"),
    visibilityToggle: document.getElementById("visibilityToggle"),
    scopePosts: document.getElementById("scopePosts"),
    scopeComments: document.getElementById("scopeComments"),
    scopeChats: document.getElementById("scopeChats"),
    scopeBadges: document.getElementById("scopeBadges"),
    scopeActivity: document.getElementById("scopeActivity"),
    saveProfileBtn: document.getElementById("saveProfileBtn"),
    badgeList: document.getElementById("badgeList"),
    badgeForm: document.getElementById("badgeForm"),
    badgeName: document.getElementById("badgeName"),
    badgeIcon: document.getElementById("badgeIcon"),
    badgeDescription: document.getElementById("badgeDescription"),
    activityList: document.getElementById("activityList"),
    activityForm: document.getElementById("activityForm"),
    activityType: document.getElementById("activityType"),
    activityTitle: document.getElementById("activityTitle"),
    activityDetail: document.getElementById("activityDetail"),
    activityLink: document.getElementById("activityLink"),
    recentPosts: document.getElementById("recentPosts"),
    recentComments: document.getElementById("recentComments"),
    recentChats: document.getElementById("recentChats")
  };

  if (elements.avatarPlaceholder) {
    elements.avatarPlaceholder.textContent = "🌟";
  }

  const state = {
    badges: [],
    activityHistory: []
  };

  const activityLabels = {
    post: "게시글",
    comment: "댓글",
    chat: "채팅",
    achievement: "업적",
    system: "시스템",
    custom: "활동"
  };

  function showToast(message, type = "success") {
    const root = document.getElementById("toastRoot") || document.body;
    const toast = document.createElement("div");
    toast.className = `notification-popup ${type}`;
    toast.textContent = message;
    root.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
    setTimeout(() => {
      toast.classList.add("fade-out");
      toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 2600);
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function updateAvatarPreview(photoPath) {
    if (photoPath) {
      elements.profilePic.src = photoPath;
      elements.profilePic.style.display = "block";
      elements.avatarWrapper.classList.add("has-image");
      elements.avatarPlaceholder.style.display = "none";
    } else {
      elements.profilePic.removeAttribute("src");
      elements.profilePic.style.display = "none";
      elements.avatarWrapper.classList.remove("has-image");
      elements.avatarPlaceholder.style.display = "flex";
      elements.avatarPlaceholder.textContent = "🌟";
    }
  }

  function updateBackgroundPreview(imagePath) {
    if (imagePath) {
      elements.backgroundPreview.src = imagePath;
      elements.backgroundPreview.style.display = "block";
      elements.backgroundWrapper.classList.add("has-image");
    } else {
      elements.backgroundPreview.removeAttribute("src");
      elements.backgroundPreview.style.display = "none";
      elements.backgroundWrapper.classList.remove("has-image");
    }
  }

  function renderBadges() {
    elements.badgeList.innerHTML = "";
    if (!state.badges.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "등록된 뱃지가 없습니다.";
      elements.badgeList.appendChild(empty);
      return;
    }

    state.badges.forEach((badge, index) => {
      const item = document.createElement("li");
      item.className = "badge-chip";
      if (badge.icon) {
        if (/^https?:\/\//i.test(badge.icon)) {
          const img = document.createElement("img");
          img.src = badge.icon;
          img.alt = `${badge.name} 아이콘`;
          item.appendChild(img);
        } else {
          const iconSpan = document.createElement("span");
          iconSpan.textContent = badge.icon;
          item.appendChild(iconSpan);
        }
      }
      const label = document.createElement("span");
      label.textContent = badge.name;
      label.title = badge.description || "";
      item.appendChild(label);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `${badge.name} 뱃지 삭제`);
      removeBtn.dataset.removeBadge = index.toString();
      removeBtn.textContent = "×";
      item.appendChild(removeBtn);

      elements.badgeList.appendChild(item);
    });
  }

  function renderActivity() {
    elements.activityList.innerHTML = "";
    if (!state.activityHistory.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "기록된 활동이 없습니다.";
      elements.activityList.appendChild(empty);
      return;
    }

    state.activityHistory.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "activity-item";

      const header = document.createElement("span");
      const typeLabel = activityLabels[entry.type] || activityLabels.custom;
      header.textContent = `${typeLabel} • ${formatDateTime(entry.occurredAt)}`;
      item.appendChild(header);

      const title = document.createElement("strong");
      title.textContent = entry.title;
      item.appendChild(title);

      if (entry.detail) {
        const detail = document.createElement("span");
        detail.textContent = entry.detail;
        item.appendChild(detail);
      }

      if (entry.link) {
        const anchor = document.createElement("a");
        anchor.href = entry.link;
        anchor.target = "_blank";
        anchor.rel = "noopener";
        anchor.textContent = "바로가기";
        item.appendChild(anchor);
      }

      elements.activityList.appendChild(item);
    });
  }

  function renderRecentList(container, items, emptyMessage, buildItem) {
    container.innerHTML = "";
    if (!items || !items.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = emptyMessage;
      container.appendChild(empty);
      return;
    }

    items.forEach((entry) => {
      const node = buildItem(entry);
      container.appendChild(node);
    });
  }

  function buildRecentPost(post) {
    const item = document.createElement("li");
    item.className = "recent-item";

    const link = document.createElement("a");
    link.href = `/board.html?id=${post._id}`;
    link.textContent = post.title || "제목 없음";
    item.appendChild(link);

    const meta = document.createElement("span");
    const category = post.category || "카테고리 없음";
    meta.textContent = `${category} • ${formatDateTime(post.time)}`;
    item.appendChild(meta);

    return item;
  }

  function buildRecentComment(comment) {
    const item = document.createElement("li");
    item.className = "recent-item";

    const excerpt = document.createElement("div");
    excerpt.textContent = comment.content || "내용 없음";
    item.appendChild(excerpt);

    const link = document.createElement("a");
    link.href = `/board.html?id=${comment.postId}`;
    link.textContent = `"${comment.postTitle || "게시글"}"으로 이동`;
    item.appendChild(link);

    const meta = document.createElement("time");
    meta.dateTime = new Date(comment.time).toISOString();
    meta.textContent = formatDateTime(comment.time);
    item.appendChild(meta);

    return item;
  }

  function buildRecentChat(chat) {
    const item = document.createElement("li");
    item.className = "recent-item";

    const preview = document.createElement("div");
    preview.textContent = chat.messageType === "image" ? "[이미지 메시지]" : chat.message;
    item.appendChild(preview);

    const meta = document.createElement("time");
    meta.dateTime = new Date(chat.time).toISOString();
    meta.textContent = `방 ${chat.room} • ${formatDateTime(chat.time)}`;
    item.appendChild(meta);

    return item;
  }

  async function loadOverview() {
    try {
      const res = await fetch("/api/profile/overview", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("프로필 정보를 불러오지 못했습니다.");
      const data = await res.json();

      if (data.profile) {
        elements.displayName.value = data.profile.name || data.profile.username || "";
        elements.introInput.value = data.profile.intro || "";
        elements.statusMessageInput.value = data.profile.statusMessage || "";
        elements.visibilityToggle.checked = data.profile.profileVisibility !== "private";

        const scopes = data.profile.visibilityScopes || {};
        elements.scopePosts.value = scopes.posts || "public";
        elements.scopeComments.value = scopes.comments || "followers";
        elements.scopeChats.value = scopes.chats || "private";
        elements.scopeBadges.value = scopes.badges || "public";
        elements.scopeActivity.value = scopes.activity || "followers";

        updateAvatarPreview(data.profile.photo);
        updateBackgroundPreview(data.profile.backgroundImage);

        state.badges = Array.isArray(data.profile.badges) ? [...data.profile.badges] : [];
      }

      state.activityHistory = Array.isArray(data.activityHistory)
        ? [...data.activityHistory]
        : Array.isArray(data.profile?.activityHistory)
          ? [...data.profile.activityHistory]
          : [];

      renderBadges();
      renderActivity();

      renderRecentList(elements.recentPosts, data.recentPosts, "최근 게시글이 없습니다.", buildRecentPost);
      renderRecentList(elements.recentComments, data.recentComments, "최근 댓글이 없습니다.", buildRecentComment);
      renderRecentList(elements.recentChats, data.recentChats, "최근 채팅이 없습니다.", buildRecentChat);
    } catch (error) {
      console.error(error);
      showToast("프로필 정보를 불러오지 못했습니다.", "error");
    }
  }

  async function saveProfile() {
    let success = true;
    try {
      const payload = {
        name: elements.displayName.value.trim(),
        intro: elements.introInput.value.trim(),
        statusMessage: elements.statusMessageInput.value.trim(),
        profileVisibility: elements.visibilityToggle.checked ? "public" : "private",
        visibilityScopes: {
          posts: elements.scopePosts.value,
          comments: elements.scopeComments.value,
          chats: elements.scopeChats.value,
          badges: elements.scopeBadges.value,
          activity: elements.scopeActivity.value
        }
      };

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("프로필 저장 실패");
    } catch (error) {
      success = false;
      console.error(error);
      showToast("프로필 정보를 저장하지 못했습니다.", "error");
    }

    try {
      const res = await fetch("/api/profile/badges", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ badges: state.badges })
      });
      if (!res.ok) throw new Error("배지 저장 실패");
    } catch (error) {
      success = false;
      console.error(error);
      showToast("배지를 저장하지 못했습니다.", "error");
    }

    if (success) {
      showToast("프로필이 저장되었습니다.");
      loadOverview();
    }
  }

  async function uploadAvatar(file) {
    const formData = new FormData();
    formData.append("photo", file);
    try {
      const res = await fetch("/api/profile/photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) throw new Error("프로필 사진 업로드 실패");
      const data = await res.json();
      updateAvatarPreview(data.path);
      showToast("프로필 사진이 업데이트되었습니다.");
    } catch (error) {
      console.error(error);
      showToast("프로필 사진 업로드에 실패했습니다.", "error");
    }
  }

  async function removeAvatar() {
    try {
      const res = await fetch("/api/profile/photo", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("프로필 사진 삭제 실패");
      updateAvatarPreview("");
      showToast("프로필 사진이 삭제되었습니다.", "info");
    } catch (error) {
      console.error(error);
      showToast("프로필 사진을 삭제하지 못했습니다.", "error");
    }
  }

  async function uploadBackground(file) {
    const formData = new FormData();
    formData.append("background", file);
    try {
      const res = await fetch("/api/profile/background", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) throw new Error("배경 이미지 업로드 실패");
      const data = await res.json();
      updateBackgroundPreview(data.path);
      showToast("배경 이미지가 업데이트되었습니다.");
    } catch (error) {
      console.error(error);
      showToast("배경 이미지를 업로드하지 못했습니다.", "error");
    }
  }

  async function removeBackground() {
    try {
      const res = await fetch("/api/profile/background", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("배경 이미지 삭제 실패");
      updateBackgroundPreview("");
      showToast("배경 이미지가 삭제되었습니다.", "info");
    } catch (error) {
      console.error(error);
      showToast("배경 이미지를 삭제하지 못했습니다.", "error");
    }
  }

  elements.badgeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.badgeName.value.trim();
    if (!name) {
      showToast("뱃지 이름을 입력해 주세요.", "warning");
      return;
    }

    state.badges.push({
      name,
      icon: elements.badgeIcon.value.trim(),
      description: elements.badgeDescription.value.trim(),
      earnedAt: new Date().toISOString()
    });

    elements.badgeForm.reset();
    renderBadges();
  });

  elements.badgeList.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.dataset.removeBadge) {
      const index = Number.parseInt(target.dataset.removeBadge, 10);
      if (!Number.isNaN(index)) {
        state.badges.splice(index, 1);
        renderBadges();
      }
    }
  });

  elements.activityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      type: elements.activityType.value,
      title: elements.activityTitle.value.trim(),
      detail: elements.activityDetail.value.trim(),
      link: elements.activityLink.value.trim()
    };

    if (!payload.title) {
      showToast("활동 제목을 입력해 주세요.", "warning");
      return;
    }

    try {
      const res = await fetch("/api/profile/activity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("활동 추가 실패");
      const data = await res.json();
      state.activityHistory = Array.isArray(data.activityHistory) ? data.activityHistory : [];
      renderActivity();
      elements.activityForm.reset();
      showToast("활동이 추가되었습니다.");
    } catch (error) {
      console.error(error);
      showToast("활동을 추가하지 못했습니다.", "error");
    }
  });

  elements.saveProfileBtn.addEventListener("click", saveProfile);

  elements.avatarUploadBtn.addEventListener("click", () => elements.profilePicInput.click());
  elements.profilePicInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadAvatar(file);
    event.target.value = "";
  });
  elements.avatarRemoveBtn.addEventListener("click", removeAvatar);

  elements.backgroundUploadBtn.addEventListener("click", () => elements.backgroundInput.click());
  elements.backgroundInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadBackground(file);
    event.target.value = "";
  });
  elements.backgroundRemoveBtn.addEventListener("click", removeBackground);

  loadOverview();
})();
