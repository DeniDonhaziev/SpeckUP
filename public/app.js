const state = {
  config: { aiEnabled: false, maxRecordingSeconds: 90 },
  categories: [],
  category: "everyday",
  topic: "",
  durationSeconds: 60,
  prepTimer: null,
  recordTimer: null,
  loadingTimer: null,
  stream: null,
  mediaRecorder: null,
  chunks: [],
  audioSegments: [],
  micWatchdog: null,
  micMuteTimer: null,
  recognitionRestartTimer: null,
  recognitionGeneration: 0,
  finishingRecording: false,
  recoveringMicrophone: false,
  recognition: null,
  finalTranscript: "",
  interimTranscript: "",
  isRecording: false,
  audioContext: null,
  analyser: null,
  animationFrame: null,
  silenceStart: null,
  pauseSegments: [],
  recordingStartedAt: 0,
  recordingEndedAt: 0,
  user: null,
  authAfterLogin: "dashboard",
  dashboard: null,
  homeworks: [],
  leaderboard: [],
  admin: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const el = {
  brandButton: $("#brandButton"),
  aboutButton: $("#aboutButton"),
  closeDialogButton: $("#closeDialogButton"),
  aboutDialog: $("#aboutDialog"),
  modeBadge: $("#modeBadge"),
  beginButton: $("#beginButton"),
  categoryGrid: $("#categoryGrid"),
  topicCategoryLabel: $("#topicCategoryLabel"),
  topicText: $("#topicText"),
  newTopicButton: $("#newTopicButton"),
  prepareButton: $("#prepareButton"),
  prepTopic: $("#prepTopic"),
  prepCountdown: $("#prepCountdown"),
  skipPrepButton: $("#skipPrepButton"),
  recordTopic: $("#recordTopic"),
  recordTimer: $("#recordTimer"),
  timerProgress: $("#timerProgress"),
  waveform: $("#waveform"),
  stopButton: $("#stopButton"),
  liveTranscript: $("#liveTranscript"),
  recognitionStatus: $("#recognitionStatus"),
  microphoneStatus: $("#microphoneStatus"),
  loadingText: $("#loadingText"),
  resultTitle: $("#resultTitle"),
  resultSummary: $("#resultSummary"),
  overallScore: $("#overallScore"),
  warningsBox: $("#warningsBox"),
  wpmValue: $("#wpmValue"),
  paceFeedback: $("#paceFeedback"),
  fillersValue: $("#fillersValue"),
  fillersFeedback: $("#fillersFeedback"),
  pausesValue: $("#pausesValue"),
  pausesFeedback: $("#pausesFeedback"),
  structureValue: $("#structureValue"),
  structureFeedback: $("#structureFeedback"),
  transcriptText: $("#transcriptText"),
  fillerList: $("#fillerList"),
  recommendationList: $("#recommendationList"),
  nextExercise: $("#nextExercise"),
  aiPanel: $("#aiPanel"),
  miniScores: $("#miniScores"),
  strengthsList: $("#strengthsList"),
  issuesList: $("#issuesList"),
  improvedAnswer: $("#improvedAnswer"),
  retryButton: $("#retryButton"),
  anotherButton: $("#anotherButton"),
  toast: $("#toast"),
  mainNav: $("#mainNav"),
  adminNavButton: $("#adminNavButton"),
  authButton: $("#authButton"),
  userMenu: $("#userMenu"),
  profileButton: $("#profileButton"),
  userInitial: $("#userInitial"),
  userName: $("#userName"),
  logoutButton: $("#logoutButton"),
  authDialog: $("#authDialog"),
  closeAuthButton: $("#closeAuthButton"),
  loginForm: $("#loginForm"),
  registerForm: $("#registerForm"),
  dashboardName: $("#dashboardName"),
  dashboardTrainButton: $("#dashboardTrainButton"),
  dashboardStats: $("#dashboardStats"),
  recentResults: $("#recentResults"),
  dashboardHomeworks: $("#dashboardHomeworks"),
  leaderboardPodium: $("#leaderboardPodium"),
  leaderboardList: $("#leaderboardList"),
  homeworkGrid: $("#homeworkGrid"),
  homeworkDialog: $("#homeworkDialog"),
  closeHomeworkDialog: $("#closeHomeworkDialog"),
  homeworkDialogTitle: $("#homeworkDialogTitle"),
  homeworkDialogDescription: $("#homeworkDialogDescription"),
  homeworkSubmitForm: $("#homeworkSubmitForm"),
  homeworkForm: $("#homeworkForm"),
  adminSummary: $("#adminSummary"),
  adminHomeworkList: $("#adminHomeworkList"),
  adminSubmissionList: $("#adminSubmissionList"),
  adminUserList: $("#adminUserList"),
  launchWarning: $("#launchWarning")
};

const timerRadius = 105;
const timerCircumference = 2 * Math.PI * timerRadius;
el.timerProgress.style.strokeDasharray = `${timerCircumference}`;
el.timerProgress.style.strokeDashoffset = "0";

init();

async function fetchJsonWithRetry(url, attempts = 4, delayMs = 1500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError || new Error("Request failed");
}

async function init() {
  bindEvents();
  if (window.location.protocol === "file:") {
    el.launchWarning?.classList.remove("hidden");
    updateModeBadge();
    updateAuthUI();
    renderCategories();
    return;
  }
  el.modeBadge.textContent = "Подключаем ИИ…";
  try {
    const [configPayload, categoriesPayload, sessionResponse] = await Promise.all([
      fetchJsonWithRetry("/api/config"),
      fetchJsonWithRetry("/api/categories"),
      fetch("/api/auth/me")
    ]);

    state.config = configPayload;
    state.categories = categoriesPayload.categories || [];
    if (sessionResponse.ok) {
      const payload = await sessionResponse.json();
      state.user = payload.user || null;
    }
  } catch {
    showToast("Сервер просыпается… Обновите страницу через 10 секунд (Ctrl+F5).");
  }

  updateModeBadge();
  updateAuthUI();
  renderCategories();
  await loadTopic();
  if (state.user) await navigate("dashboard");
}

function bindEvents() {
  el.beginButton.addEventListener("click", () => navigate("setup"));
  el.newTopicButton.addEventListener("click", () => loadTopic(true));
  el.prepareButton.addEventListener("click", beginPreparation);
  el.skipPrepButton.addEventListener("click", startRecording);
  el.stopButton.addEventListener("click", finishRecording);
  el.retryButton.addEventListener("click", beginPreparation);
  el.anotherButton.addEventListener("click", async () => {
    await navigate("setup");
    await loadTopic(true);
  });
  el.brandButton.addEventListener("click", () => {
    if (state.isRecording) return showToast("Сначала закончите текущую запись.");
    clearActiveTimers();
    navigate(state.user ? "dashboard" : "home");
  });
  el.aboutButton.addEventListener("click", () => el.aboutDialog.showModal());
  el.closeDialogButton.addEventListener("click", () => el.aboutDialog.close());
  el.aboutDialog.addEventListener("click", (event) => {
    const rect = el.aboutDialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) el.aboutDialog.close();
  });
  el.authButton.addEventListener("click", () => openAuth("login"));
  el.closeAuthButton.addEventListener("click", () => el.authDialog.close());
  el.loginForm.addEventListener("submit", handleLogin);
  el.registerForm.addEventListener("submit", handleRegister);
  el.logoutButton.addEventListener("click", handleLogout);
  el.profileButton.addEventListener("click", () => navigate("dashboard"));
  el.dashboardTrainButton.addEventListener("click", () => navigate("setup"));
  el.closeHomeworkDialog.addEventListener("click", () => el.homeworkDialog.close());
  el.homeworkSubmitForm.addEventListener("submit", handleHomeworkSubmit);
  el.homeworkForm.addEventListener("submit", handleCreateHomework);
  $$('[data-nav]').forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  $$('[data-auth-tab]').forEach((button) => button.addEventListener("click", () => switchAuthTab(button.dataset.authTab)));
  $$('[data-admin-tab]').forEach((button) => button.addEventListener("click", () => switchAdminTab(button.dataset.adminTab)));
  window.addEventListener("beforeunload", releaseMedia);
}

function updateModeBadge() {
  if (state.config.aiEnabled) {
    el.modeBadge.textContent = "ИИ-анализ включён";
    el.modeBadge.classList.add("ai");
  } else {
    el.modeBadge.textContent = "Деморежим";
    el.modeBadge.classList.remove("ai");
  }
}

function renderCategories() {
  if (!state.categories.length) {
    state.categories = [
      { id: "everyday", title: "Повседневные", emoji: "☀️", count: 10 },
      { id: "work", title: "Работа и карьера", emoji: "💼", count: 10 },
      { id: "debate", title: "Дебаты", emoji: "⚖️", count: 10 },
      { id: "stories", title: "Истории", emoji: "🎬", count: 10 },
      { id: "explain", title: "Объясни просто", emoji: "💡", count: 10 },
      { id: "sales", title: "Продажи", emoji: "🤝", count: 10 }
    ];
  }

  el.categoryGrid.replaceChildren();
  for (const category of state.categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${category.id === state.category ? " active" : ""}`;
    button.dataset.category = category.id;

    const emoji = document.createElement("span");
    emoji.textContent = category.emoji;
    const title = document.createElement("strong");
    title.textContent = category.title;
    const count = document.createElement("small");
    count.textContent = `${category.count} тем`;

    button.append(emoji, title, count);
    button.addEventListener("click", async () => {
      state.category = category.id;
      renderCategories();
      await loadTopic(true);
    });
    el.categoryGrid.append(button);
  }
}

async function loadTopic(excludeCurrent = false) {
  el.topicText.textContent = "Подбираем тему…";
  const selected = state.categories.find((item) => item.id === state.category);
  el.topicCategoryLabel.textContent = selected?.title || "Тренировка";

  try {
    const query = new URLSearchParams({ category: state.category });
    if (excludeCurrent && state.topic) query.set("exclude", state.topic);
    const response = await fetch(`/api/topic?${query}`);
    if (!response.ok) throw new Error("Не удалось получить тему");
    const payload = await response.json();
    state.topic = payload.topic;
  } catch {
    state.topic = "Объясните, почему умение ясно говорить важно в повседневной жизни.";
  }

  el.topicText.textContent = state.topic;
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.toggle("view-active", view.dataset.view === name));
  $$('[data-nav]').forEach((button) => button.classList.toggle("active", button.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function beginPreparation() {
  clearActiveTimers();
  el.prepTopic.textContent = state.topic;
  let remaining = 15;
  el.prepCountdown.textContent = String(remaining);
  showView("prep");

  state.prepTimer = window.setInterval(() => {
    remaining -= 1;
    el.prepCountdown.textContent = String(Math.max(remaining, 0));
    if (remaining <= 0) startRecording();
  }, 1000);
}

async function startRecording() {
  clearActiveTimers();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showView("setup");
    showToast("Этот браузер не поддерживает запись. Откройте сайт в последней версии Chrome или Edge.");
    return;
  }

  resetRecordingState();
  el.recordTopic.textContent = state.topic;
  el.liveTranscript.textContent = "Начните говорить — текст появится здесь.";
  el.recordTimer.textContent = formatTime(state.durationSeconds);
  el.timerProgress.style.strokeDashoffset = "0";
  setMicrophoneStatus("Подключаем микрофон…", "connecting");
  showView("record");

  try {
    state.stream = await requestMicrophoneStream();
    state.isRecording = true;
    state.recordingStartedAt = performance.now();
    await startCaptureSegment(state.stream);
    bindMicrophoneTrack(state.stream);
    startSpeechRecognition();
    startAudioVisualization();
    startRecordTimer();
    startMicrophoneWatchdog();
    setMicrophoneStatus("Микрофон работает", "on");
  } catch (error) {
    state.isRecording = false;
    releaseMedia();
    showView("setup");
    showToast(error.message || "Нет доступа к микрофону. Разрешите его в настройках браузера и попробуйте снова.");
  }
}

function requestMicrophoneStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
  });
}

function resetRecordingState() {
  state.chunks = [];
  state.audioSegments = [];
  state.finalTranscript = "";
  state.interimTranscript = "";
  state.pauseSegments = [];
  state.silenceStart = null;
  state.recordingStartedAt = 0;
  state.recordingEndedAt = 0;
  state.finishingRecording = false;
  state.recoveringMicrophone = false;
  state.recognitionGeneration += 1;
  clearTimeout(state.recognitionRestartTimer);
  clearTimeout(state.micMuteTimer);
  clearInterval(state.micWatchdog);
}

function chooseMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startCaptureSegment(stream) {
  const mimeType = chooseMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const segmentChunks = [];
  state.mediaRecorder = recorder;
  state.chunks = segmentChunks;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size > 0) segmentChunks.push(event.data);
  });

  recorder.addEventListener("error", () => {
    if (state.isRecording && !state.finishingRecording) recoverMicrophone("Ошибка записи микрофона");
  });

  recorder.addEventListener("stop", () => {
    if (segmentChunks.length) {
      const type = recorder.mimeType || segmentChunks[0]?.type || "audio/webm";
      const blob = new Blob(segmentChunks, { type });
      if (blob.size > 0) state.audioSegments.push(blob);
    }
    if (state.isRecording && !state.finishingRecording && !state.recoveringMicrophone) {
      recoverMicrophone("Запись неожиданно остановилась");
    }
  });

  recorder.start(1000);
}

function stopCaptureSegment() {
  return new Promise((resolve) => {
    const recorder = state.mediaRecorder;
    if (!recorder || recorder.state === "inactive") return resolve();
    recorder.addEventListener("stop", resolve, { once: true });
    try { recorder.requestData(); } catch { /* браузер может не поддерживать запрос */ }
    try { recorder.stop(); } catch { resolve(); }
  });
}

function bindMicrophoneTrack(stream) {
  const track = stream?.getAudioTracks?.()[0];
  if (!track) return;

  track.addEventListener("ended", () => {
    if (state.isRecording && !state.finishingRecording) recoverMicrophone("Микрофон был отключён");
  }, { once: true });

  track.addEventListener("mute", () => {
    clearTimeout(state.micMuteTimer);
    state.micMuteTimer = window.setTimeout(() => {
      if (state.isRecording && track.muted && track.readyState === "live") recoverMicrophone("Микрофон перестал передавать звук");
    }, 3000);
  });

  track.addEventListener("unmute", () => {
    clearTimeout(state.micMuteTimer);
    setMicrophoneStatus("Микрофон работает", "on");
  });
}

function startMicrophoneWatchdog() {
  clearInterval(state.micWatchdog);
  state.micWatchdog = window.setInterval(() => {
    if (!state.isRecording || state.finishingRecording || state.recoveringMicrophone) return;
    const track = state.stream?.getAudioTracks?.()[0];
    if (!track || track.readyState === "ended") {
      recoverMicrophone("Потеряно подключение к микрофону");
      return;
    }
    if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") {
      recoverMicrophone("Запись остановилась");
    }
  }, 1500);
}

async function recoverMicrophone(reason) {
  if (!state.isRecording || state.finishingRecording || state.recoveringMicrophone) return;
  state.recoveringMicrophone = true;
  setMicrophoneStatus("Восстанавливаем микрофон…", "warning");
  showToast(`${reason}. Пытаемся продолжить запись автоматически.`);

  try {
    await stopCaptureSegment();
    stopAudioVisualization();
    state.stream?.getTracks?.().forEach((track) => track.stop());
    const recoveredStream = await requestMicrophoneStream();
    if (!state.isRecording || state.finishingRecording) {
      recoveredStream.getTracks().forEach((track) => track.stop());
      state.recoveringMicrophone = false;
      return;
    }
    state.stream = recoveredStream;
    await startCaptureSegment(state.stream);
    bindMicrophoneTrack(state.stream);
    startAudioVisualization();
    setMicrophoneStatus("Микрофон восстановлен", "on");
  } catch {
    setMicrophoneStatus("Микрофон отключён", "error");
    showToast("Не удалось вернуть микрофон. Сохраняем уже записанную часть выступления.");
    state.recoveringMicrophone = false;
    await finishRecording();
    return;
  }

  state.recoveringMicrophone = false;
}

function setMicrophoneStatus(text, status = "") {
  if (!el.microphoneStatus) return;
  el.microphoneStatus.textContent = text;
  el.microphoneStatus.className = `microphone-status${status ? ` ${status}` : ""}`;
}

function startRecordTimer() {
  const update = () => {
    if (!state.isRecording) return;
    const elapsed = (performance.now() - state.recordingStartedAt) / 1000;
    const remaining = Math.max(0, state.durationSeconds - elapsed);
    el.recordTimer.textContent = formatTime(Math.ceil(remaining));
    const ratio = Math.min(1, elapsed / state.durationSeconds);
    el.timerProgress.style.strokeDashoffset = String(timerCircumference * ratio);
    if (remaining <= 0) finishRecording();
  };

  update();
  state.recordTimer = window.setInterval(update, 100);
}

function scheduleRecognitionRestart(recognition, generation) {
  clearTimeout(state.recognitionRestartTimer);
  state.recognitionRestartTimer = window.setTimeout(() => {
    if (!state.isRecording || state.finishingRecording || generation !== state.recognitionGeneration) return;
    try { recognition.start(); } catch { scheduleRecognitionRestart(recognition, generation); }
  }, 350);
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    el.recognitionStatus.textContent = state.config.aiEnabled ? "аудио записывается полностью" : "субтитры недоступны";
    el.recognitionStatus.classList.remove("on");
    return;
  }

  const recognition = new SpeechRecognition();
  const generation = state.recognitionGeneration;
  recognition.lang = "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  state.recognition = recognition;

  recognition.addEventListener("start", () => {
    if (generation !== state.recognitionGeneration) return;
    el.recognitionStatus.textContent = "слушает весь ответ";
    el.recognitionStatus.classList.add("on");
  });

  recognition.addEventListener("result", (event) => {
    if (generation !== state.recognitionGeneration) return;
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) state.finalTranscript += `${text.trim()} `;
      else interim += text;
    }
    state.interimTranscript = interim;
    const combined = `${state.finalTranscript}${state.interimTranscript}`.trim();
    el.liveTranscript.textContent = combined || "Продолжайте говорить…";
    el.liveTranscript.scrollTop = el.liveTranscript.scrollHeight;
  });

  recognition.addEventListener("error", (event) => {
    if (generation !== state.recognitionGeneration || !state.isRecording) return;
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      el.recognitionStatus.textContent = "субтитры недоступны, аудио пишется";
      el.recognitionStatus.classList.remove("on");
      return;
    }
    if (event.error !== "aborted") scheduleRecognitionRestart(recognition, generation);
  });

  recognition.addEventListener("end", () => {
    if (state.isRecording && !state.finishingRecording && generation === state.recognitionGeneration) {
      el.recognitionStatus.textContent = "перезапускаем субтитры";
      el.recognitionStatus.classList.remove("on");
      scheduleRecognitionRestart(recognition, generation);
    } else {
      el.recognitionStatus.textContent = "готово";
      el.recognitionStatus.classList.remove("on");
    }
  });

  try { recognition.start(); }
  catch { scheduleRecognitionRestart(recognition, generation); }
}

function startAudioVisualization() {
  stopAudioVisualization();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !state.stream) return;

  state.audioContext = new AudioContext();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  state.analyser.smoothingTimeConstant = 0.78;
  const source = state.audioContext.createMediaStreamSource(state.stream);
  source.connect(state.analyser);

  const canvas = el.waveform;
  const context = canvas.getContext("2d");
  const data = new Uint8Array(state.analyser.fftSize);

  const draw = () => {
    if (!state.isRecording) return;
    state.analyser.getByteTimeDomainData(data);
    const rms = Math.sqrt(data.reduce((sum, value) => {
      const normalized = (value - 128) / 128;
      return sum + normalized * normalized;
    }, 0) / data.length);

    detectPause(rms);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 3;
    context.strokeStyle = "#6d5dfc";
    context.beginPath();

    const step = canvas.width / data.length;
    for (let index = 0; index < data.length; index += 1) {
      const x = index * step;
      const y = (data[index] / 255) * canvas.height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();

    context.strokeStyle = "rgba(23,25,22,.08)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, canvas.height / 2);
    context.lineTo(canvas.width, canvas.height / 2);
    context.stroke();

    state.animationFrame = requestAnimationFrame(draw);
  };

  draw();
}

function stopAudioVisualization() {
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  if (state.audioContext && state.audioContext.state !== "closed") state.audioContext.close().catch(() => {});
  state.audioContext = null;
  state.analyser = null;
}

function detectPause(rms) {
  const now = performance.now();
  const elapsed = (now - state.recordingStartedAt) / 1000;
  if (elapsed < 1) return;

  const silenceThreshold = 0.026;
  if (rms < silenceThreshold) {
    if (state.silenceStart === null) state.silenceStart = now;
    return;
  }

  finalizePendingPause(now);
}

function finalizePendingPause(now = performance.now()) {
  if (state.silenceStart === null) return;
  const duration = (now - state.silenceStart) / 1000;
  if (duration >= 0.8) state.pauseSegments.push(duration);
  state.silenceStart = null;
}

async function finishRecording() {
  if ((!state.isRecording && !state.recoveringMicrophone) || state.finishingRecording) return;
  state.finishingRecording = true;
  state.isRecording = false;
  state.recordingEndedAt = performance.now();
  clearInterval(state.recordTimer);
  clearInterval(state.micWatchdog);
  clearTimeout(state.micMuteTimer);
  clearTimeout(state.recognitionRestartTimer);
  state.recordTimer = null;
  state.micWatchdog = null;
  finalizePendingPause(state.recordingEndedAt);
  setMicrophoneStatus("Запись завершена", "");

  state.recognitionGeneration += 1;
  if (state.recognition) {
    try { state.recognition.abort(); } catch { /* уже остановлено */ }
  }
  stopAudioVisualization();
  await stopCaptureSegment();

  const actualDuration = Math.max(1, (state.recordingEndedAt - state.recordingStartedAt) / 1000);
  const audioSegments = state.audioSegments.filter((blob) => blob?.size > 0);
  releaseMedia({ keepSegments: true });

  if (!audioSegments.length && !`${state.finalTranscript}${state.interimTranscript}`.trim()) {
    state.finishingRecording = false;
    showView("setup");
    showToast("Запись получилась пустой. Проверьте выбранный микрофон и попробуйте снова.");
    return;
  }

  showView("loading");
  startLoadingMessages();

  try {
    const result = await requestAnalysis(audioSegments, actualDuration);
    stopLoadingMessages();
    renderResults(result);
    showView("results");
  } catch (error) {
    stopLoadingMessages();
    showView("setup");
    showToast(error.message || "Не удалось обработать запись.");
  } finally {
    state.finishingRecording = false;
    state.audioSegments = [];
  }
}

async function requestAnalysis(audioSegments, durationSeconds) {
  const form = new FormData();
  audioSegments.forEach((audioBlob, index) => {
    const extension = audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
    form.append(`audio${index}`, audioBlob, `speech-${index + 1}.${extension}`);
  });
  form.append("topic", state.topic);
  form.append("category", state.category);
  form.append("durationSeconds", String(durationSeconds));
  form.append("transcript", `${state.finalTranscript}${state.interimTranscript}`.trim());
  form.append("pauses", JSON.stringify(buildPauseStats()));

  const response = await fetch("/api/analyze", { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Ошибка сервера (${response.status})`);
  return payload;
}

function buildPauseStats() {
  const values = state.pauseSegments.filter((value) => value >= 0.8);
  return {
    count: values.length,
    maxSeconds: values.length ? Math.max(...values) : 0,
    totalSeconds: values.reduce((sum, value) => sum + value, 0)
  };
}

function releaseMedia({ keepSegments = false } = {}) {
  clearInterval(state.micWatchdog);
  clearTimeout(state.micMuteTimer);
  clearTimeout(state.recognitionRestartTimer);
  state.micWatchdog = null;
  state.micMuteTimer = null;
  state.recognitionRestartTimer = null;
  state.stream?.getTracks?.().forEach((track) => track.stop());
  state.stream = null;
  stopAudioVisualization();
  state.mediaRecorder = null;
  state.recognition = null;
  state.chunks = [];
  if (!keepSegments) state.audioSegments = [];
}

function startLoadingMessages() {
  const messages = [
    "Расшифровываем речь и считаем слова-паразиты…",
    "Проверяем темп, паузы и повторы…",
    "Оцениваем структуру и ясность ответа…",
    "Готовим рекомендации для следующей попытки…"
  ];
  let index = 0;
  el.loadingText.textContent = messages[index];
  state.loadingTimer = window.setInterval(() => {
    index = (index + 1) % messages.length;
    el.loadingText.textContent = messages[index];
  }, 1500);
}

function stopLoadingMessages() {
  clearInterval(state.loadingTimer);
  state.loadingTimer = null;
}

function renderResults(result) {
  const { metrics, coach, transcript, warnings = [] } = result;
  const score = metrics.overallScore;
  el.overallScore.textContent = String(score);
  el.resultTitle.textContent = score >= 85 ? "Сильное выступление" : score >= 70 ? "Хорошая основа" : score >= 50 ? "Есть над чем поработать" : "Начало положено";
  el.resultSummary.textContent = coach?.summary || defaultSummary(metrics);

  renderWarnings(warnings, result.aiEnabled);
  el.wpmValue.textContent = String(metrics.wpm);
  el.paceFeedback.textContent = metrics.paceFeedback;
  el.fillersValue.textContent = String(metrics.fillers.total);
  el.fillersFeedback.textContent = metrics.fillers.total
    ? `Найдены только повторяющиеся или явно лишние связки: ${metrics.fillers.details.slice(0, 2).map((item) => `«${item.word}»`).join(" и ")}.`
    : "Контекстных слов-паразитов не найдено. Одиночные «ну», «вот» и «значит» не штрафуются автоматически.";
  el.pausesValue.textContent = String(metrics.pauses.count);
  el.pausesFeedback.textContent = metrics.pauses.count
    ? `Самая длинная — ${metrics.pauses.maxSeconds.toFixed(1)} сек.`
    : "Длинных пауз не обнаружено.";
  el.structureValue.textContent = String(metrics.structureScore);
  el.structureFeedback.textContent = metrics.structureScore >= 75
    ? "Мысль развита достаточно последовательно."
    : "Добавьте явный аргумент и отдельный вывод.";

  el.transcriptText.innerHTML = highlightFillerOccurrences(transcript, metrics.fillers.occurrences || []);
  renderFillerList(metrics.fillers.details);
  renderRecommendations(metrics.recommendations, coach);
  renderCoach(coach);
}

function defaultSummary(metrics) {
  if (metrics.fillers.total === 0 && metrics.structureScore >= 75) {
    return "Ответ звучит достаточно чисто и последовательно. Теперь можно работать над выразительностью и точностью формулировок.";
  }
  if (metrics.fillers.total > 4) {
    return "Главная точка роста — заменить слова-паразиты спокойными паузами и заранее держать в уме следующий пункт ответа.";
  }
  return "Основная мысль понятна. Следующая попытка станет сильнее, если сделать вывод заметнее и сократить лишние связки.";
}

function renderWarnings(warnings, aiEnabled) {
  const allWarnings = [...warnings];
  if (!aiEnabled) {
    allWarnings.push("ИИ-тренер не подключён. Проверьте ключ на https://api.tu-zi.com и вставьте в .env как AI_API_KEY. Базовые метрики (темп, паузы, паразиты) работают локально.");
  }
  if (!allWarnings.length) {
    el.warningsBox.classList.add("hidden");
    return;
  }
  el.warningsBox.replaceChildren();
  allWarnings.forEach((warning) => {
    const line = document.createElement("div");
    line.textContent = warning;
    el.warningsBox.append(line);
  });
  el.warningsBox.classList.remove("hidden");
}

function renderFillerList(details) {
  el.fillerList.replaceChildren();
  if (!details.length) {
    const chip = document.createElement("span");
    chip.className = "filler-chip";
    chip.textContent = "Чистая речь — паразиты не найдены";
    el.fillerList.append(chip);
    return;
  }
  details.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "filler-chip";
    chip.textContent = `«${item.word}» × ${item.count}`;
    el.fillerList.append(chip);
  });
}

function renderRecommendations(recommendations, coach) {
  el.recommendationList.replaceChildren();
  const list = coach?.improvements?.length
    ? coach.improvements
    : recommendations.length
      ? recommendations
      : ["Повторите ответ, сохранив ту же структуру, но сделайте формулировки короче."];
  list.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    el.recommendationList.append(item);
  });
}

function renderCoach(coach) {
  if (!coach) {
    el.aiPanel.classList.add("hidden");
    el.nextExercise.classList.add("hidden");
    return;
  }

  el.aiPanel.classList.remove("hidden");
  el.miniScores.replaceChildren();
  [
    ["По теме", coach.relevanceScore],
    ["Логика", coach.logicScore],
    ["Уверенность", coach.confidenceScore]
  ].forEach(([label, value]) => {
    const score = document.createElement("span");
    score.className = "mini-score";
    score.textContent = `${label}: ${value}`;
    el.miniScores.append(score);
  });

  el.strengthsList.replaceChildren();
  (coach.strengths || []).forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    el.strengthsList.append(item);
  });
  if (!coach.strengths?.length) {
    const item = document.createElement("li");
    item.textContent = "Вы довели ответ до конца и сохранили связь с темой.";
    el.strengthsList.append(item);
  }

  el.issuesList.replaceChildren();
  (coach.issues || []).forEach((issue) => {
    const wrapper = document.createElement("div");
    wrapper.className = "issue-item";
    const fragment = document.createElement("strong");
    fragment.textContent = issue.fragment || "Фрагмент ответа";
    const explanation = document.createElement("p");
    explanation.textContent = issue.explanation;
    const correction = document.createElement("em");
    correction.textContent = issue.correction;
    wrapper.append(fragment, explanation, correction);
    el.issuesList.append(wrapper);
  });
  if (!coach.issues?.length) {
    const empty = document.createElement("p");
    empty.textContent = "Критичных смысловых ошибок не найдено.";
    el.issuesList.append(empty);
  }

  el.improvedAnswer.textContent = coach.improvedAnswer || "ИИ не предложил переработанный вариант для этого ответа.";
  if (coach.nextExercise) {
    el.nextExercise.textContent = `Упражнение: ${coach.nextExercise}`;
    el.nextExercise.classList.remove("hidden");
  } else {
    el.nextExercise.classList.add("hidden");
  }
}

function highlightFillerOccurrences(text, occurrences) {
  const safeText = String(text || "");
  const ranges = [...occurrences]
    .filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end > item.start && item.end <= safeText.length)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return escapeHtml(safeText);

  let cursor = 0;
  const parts = [];
  for (const range of ranges) {
    if (range.start < cursor) continue;
    parts.push(escapeHtml(safeText.slice(cursor, range.start)));
    parts.push(`<mark title="${escapeHtml(range.reason || "слово-паразит")}">${escapeHtml(safeText.slice(range.start, range.end))}</mark>`);
    cursor = range.end;
  }
  parts.push(escapeHtml(safeText.slice(cursor)));
  return parts.join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function clearActiveTimers() {
  clearInterval(state.prepTimer);
  clearInterval(state.recordTimer);
  clearInterval(state.loadingTimer);
  state.prepTimer = null;
  state.recordTimer = null;
  state.loadingTimer = null;
}

let toastTimer = null;
function showToast(message) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => el.toast.classList.add("hidden"), 5000);
}


async function navigate(name) {
  const protectedViews = new Set(["dashboard", "setup", "homeworks", "admin"]);
  if (protectedViews.has(name) && !state.user) {
    state.authAfterLogin = name;
    openAuth("login");
    return;
  }
  if (name === "admin" && state.user?.role !== "admin") {
    showToast("Админ-панель доступна только администраторам.");
    return;
  }
  try {
    if (name === "dashboard") await loadDashboard();
    if (name === "leaderboard") await loadLeaderboard();
    if (name === "homeworks") await loadHomeworks();
    if (name === "admin") await loadAdmin();
    showView(name);
  } catch (error) {
    if (error.status === 401) {
      state.user = null;
      updateAuthUI();
      state.authAfterLogin = name;
      openAuth("login");
      return;
    }
    showToast(error.message || "Не удалось загрузить раздел.");
  }
}

function updateAuthUI() {
  const loggedIn = Boolean(state.user);
  el.mainNav.classList.toggle("hidden", !loggedIn);
  el.authButton.classList.toggle("hidden", loggedIn);
  el.userMenu.classList.toggle("hidden", !loggedIn);
  el.adminNavButton.classList.toggle("hidden", state.user?.role !== "admin");
  if (loggedIn) {
    el.userName.textContent = state.user.name;
    el.userInitial.textContent = state.user.name.trim().charAt(0).toUpperCase() || "У";
  }
}

function openAuth(tab = "login") {
  switchAuthTab(tab);
  if (typeof el.authDialog.showModal === "function") {
    if (!el.authDialog.open) el.authDialog.showModal();
    return;
  }
  el.authDialog.setAttribute("open", "");
}

function switchAuthTab(tab) {
  $$('[data-auth-tab]').forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
  $$('[data-auth-form]').forEach((form) => form.classList.toggle("hidden", form.dataset.authForm !== tab));
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    state.user = payload.user;
    updateAuthUI();
    el.authDialog.close();
    event.currentTarget.reset();
    showToast(`Добро пожаловать, ${state.user.name}!`);
    await navigate(state.authAfterLogin || "dashboard");
    state.authAfterLogin = "dashboard";
  } catch (error) {
    showToast(error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const payload = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password") })
    });
    state.user = payload.user;
    updateAuthUI();
    el.authDialog.close();
    event.currentTarget.reset();
    showToast("Аккаунт создан. Первая тренировка уже доступна.");
    await navigate(state.authAfterLogin || "dashboard");
    state.authAfterLogin = "dashboard";
  } catch (error) {
    showToast(error.message);
  }
}

async function handleLogout() {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* локальный выход всё равно выполняется */ }
  state.user = null;
  state.dashboard = null;
  state.admin = null;
  updateAuthUI();
  showView("home");
  showToast("Вы вышли из аккаунта.");
}

async function loadDashboard() {
  state.dashboard = await api("/api/dashboard");
  el.dashboardName.textContent = state.user?.name?.split(" ")[0] || "ученик";
  renderDashboardStats(state.dashboard.stats);
  renderRecentResults(state.dashboard.recentResults || []);
  renderDashboardHomeworks(state.dashboard.activeHomeworks || []);
}

function renderDashboardStats(stats) {
  el.dashboardStats.replaceChildren();
  const cards = [
    ["Очки", stats.points, `Уровень ${stats.level}`],
    ["Средний балл", stats.averageScore || "—", stats.trainings ? `${stats.trainings} тренировок` : "Начните первую тренировку"],
    ["Прогресс", `${stats.progress > 0 ? "+" : ""}${stats.progress}`, "к первым попыткам"],
    ["Серия", stats.streak, plural(stats.streak, "день", "дня", "дней")]
  ];
  cards.forEach(([label, value, caption]) => {
    const card = node("article", "dashboard-stat");
    card.append(node("span", "", label), node("strong", "", String(value)), node("p", "", caption));
    el.dashboardStats.append(card);
  });
}

function renderRecentResults(results) {
  el.recentResults.replaceChildren();
  if (!results.length) {
    el.recentResults.append(emptyState("Здесь появятся результаты после первой минутной тренировки."));
    return;
  }
  results.forEach((result) => {
    const item = node("div", "history-item");
    const copy = node("div");
    copy.append(node("strong", "", result.topic), node("span", "", formatDate(result.createdAt)));
    const score = node("b", scoreClass(result.score), String(result.score));
    item.append(copy, score);
    el.recentResults.append(item);
  });
}

function renderDashboardHomeworks(homeworks) {
  el.dashboardHomeworks.replaceChildren();
  if (!homeworks.length) {
    el.dashboardHomeworks.append(emptyState("Активных заданий пока нет."));
    return;
  }
  homeworks.forEach((homework) => {
    const item = node("button", "compact-homework");
    item.type = "button";
    const status = homework.submission ? submissionLabel(homework.submission) : formatDueDate(homework.dueDate);
    item.append(node("span", "", status), node("strong", "", homework.title), node("small", "", `${homework.points} баллов`));
    item.addEventListener("click", () => openHomework(homework));
    el.dashboardHomeworks.append(item);
  });
}

async function loadLeaderboard() {
  const payload = await api("/api/leaderboard");
  state.leaderboard = payload.leaderboard || [];
  renderLeaderboard();
}

function renderLeaderboard() {
  const list = state.leaderboard;
  el.leaderboardPodium.replaceChildren();
  list.slice(0, 3).forEach((entry, index) => {
    const card = node("article", `podium-card place-${index + 1}${entry.id === state.user?.id ? " current" : ""}`);
    card.append(node("span", "podium-place", `${entry.place}`), avatar(entry.name), node("strong", "", entry.name), node("b", "", `${entry.points} очков`), node("small", "", `Средний балл ${entry.averageScore || "—"}`));
    el.leaderboardPodium.append(card);
  });
  el.leaderboardList.replaceChildren();
  if (!list.length) {
    el.leaderboardList.append(emptyState("Рейтинг появится после первых тренировок."));
    return;
  }
  list.forEach((entry) => {
    const row = node("div", `leaderboard-row${entry.id === state.user?.id ? " current" : ""}`);
    const person = node("div", "leader-person");
    person.append(avatar(entry.name), node("strong", "", entry.name), entry.isDemo ? node("small", "demo-label", "демо") : document.createTextNode(""));
    row.append(
      node("b", "place-cell", String(entry.place)),
      person,
      node("span", "", String(entry.level)),
      node("span", "", entry.averageScore ? `${entry.averageScore}/100` : "—"),
      node("span", entry.progress > 0 ? "positive" : entry.progress < 0 ? "negative" : "", `${entry.progress > 0 ? "+" : ""}${entry.progress}`),
      node("strong", "", String(entry.points))
    );
    el.leaderboardList.append(row);
  });
}

async function loadHomeworks() {
  const payload = await api("/api/homeworks");
  state.homeworks = payload.homeworks || [];
  renderHomeworks();
}

function renderHomeworks() {
  el.homeworkGrid.replaceChildren();
  if (!state.homeworks.length) {
    el.homeworkGrid.append(emptyState("Администратор ещё не опубликовал задания."));
    return;
  }
  state.homeworks.forEach((homework) => {
    const card = node("article", "homework-card");
    const top = node("div", "homework-top");
    top.append(node("span", homework.submission ? "status-chip done" : "status-chip", homework.submission ? submissionLabel(homework.submission) : "Новое задание"), node("b", "", `${homework.points} баллов`));
    const description = node("p", "", homework.description);
    const meta = node("div", "homework-meta");
    meta.append(node("span", "", `${homework.durationSeconds} сек.`), node("span", "", formatDueDate(homework.dueDate)));
    const button = node("button", homework.submission?.status === "reviewed" ? "secondary-button" : "primary-button", homework.submission ? "Изменить ответ" : "Выполнить задание");
    button.type = "button";
    button.addEventListener("click", () => openHomework(homework));
    card.append(top, node("h3", "", homework.title), description, meta);
    if (homework.submission?.status === "reviewed") {
      const feedback = node("div", "homework-feedback");
      feedback.append(node("strong", "", `Оценка: ${homework.submission.score}/100`), node("p", "", homework.submission.feedback || "Проверено без комментария."));
      card.append(feedback);
    }
    card.append(button);
    el.homeworkGrid.append(card);
  });
}

function openHomework(homework) {
  el.homeworkDialogTitle.textContent = homework.title;
  el.homeworkDialogDescription.textContent = homework.description;
  el.homeworkSubmitForm.elements.homeworkId.value = homework.id;
  el.homeworkSubmitForm.elements.answer.value = homework.submission?.answer || "";
  el.homeworkDialog.showModal();
}

async function handleHomeworkSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await api(`/api/homeworks/${encodeURIComponent(data.get("homeworkId"))}/submit`, {
      method: "POST",
      body: JSON.stringify({ answer: data.get("answer") })
    });
    el.homeworkDialog.close();
    showToast("Ответ отправлен администратору на проверку.");
    await loadHomeworks();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadAdmin() {
  state.admin = await api("/api/admin/overview");
  renderAdminSummary();
  renderAdminHomeworks();
  renderAdminSubmissions();
  renderAdminUsers();
}

function renderAdminSummary() {
  el.adminSummary.replaceChildren();
  const totals = state.admin.totals;
  [["Ученики", totals.students], ["Тренировки", totals.trainings], ["Активные задания", totals.activeHomeworks], ["Ждут проверки", totals.waitingReview]].forEach(([label, value]) => {
    const card = node("article", "admin-stat");
    card.append(node("span", "", label), node("strong", "", String(value)));
    el.adminSummary.append(card);
  });
}

async function handleCreateHomework(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/admin/homeworks", {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"), description: form.get("description"), category: form.get("category"),
        durationSeconds: Number(form.get("durationSeconds")), points: Number(form.get("points")), dueDate: form.get("dueDate"), active: true
      })
    });
    event.currentTarget.reset();
    event.currentTarget.elements.durationSeconds.value = "60";
    event.currentTarget.elements.points.value = "30";
    showToast("Домашнее задание опубликовано.");
    await loadAdmin();
  } catch (error) {
    showToast(error.message);
  }
}

function renderAdminHomeworks() {
  el.adminHomeworkList.replaceChildren();
  if (!state.admin.homeworks.length) return el.adminHomeworkList.append(emptyState("Заданий пока нет."));
  state.admin.homeworks.forEach((homework) => {
    const item = node("article", "admin-item");
    const copy = node("div", "admin-item-copy");
    copy.append(node("span", homework.active ? "status-chip done" : "status-chip", homework.active ? "Опубликовано" : "Скрыто"), node("h3", "", homework.title), node("p", "", `${homework.points} баллов · ${formatDueDate(homework.dueDate)}`));
    const actions = node("div", "admin-actions");
    const toggle = node("button", "secondary-button small", homework.active ? "Скрыть" : "Опубликовать");
    toggle.type = "button";
    toggle.addEventListener("click", () => updateHomework(homework.id, { active: !homework.active }));
    const remove = node("button", "danger-button", "Удалить");
    remove.type = "button";
    remove.addEventListener("click", () => deleteHomework(homework.id, homework.title));
    actions.append(toggle, remove);
    item.append(copy, actions);
    el.adminHomeworkList.append(item);
  });
}

async function updateHomework(id, patch) {
  try {
    await api(`/api/admin/homeworks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    await loadAdmin();
  } catch (error) { showToast(error.message); }
}

async function deleteHomework(id, title) {
  if (!window.confirm(`Удалить задание «${title}» и все ответы на него?`)) return;
  try {
    await api(`/api/admin/homeworks/${encodeURIComponent(id)}`, { method: "DELETE" });
    showToast("Задание удалено.");
    await loadAdmin();
  } catch (error) { showToast(error.message); }
}

function renderAdminSubmissions() {
  el.adminSubmissionList.replaceChildren();
  if (!state.admin.submissions.length) return el.adminSubmissionList.append(emptyState("Ответов учеников пока нет."));
  state.admin.submissions.forEach((submission) => {
    const item = node("article", "admin-item submission-item");
    const copy = node("div", "admin-item-copy");
    copy.append(node("span", submission.status === "reviewed" ? "status-chip done" : "status-chip", submission.status === "reviewed" ? "Проверено" : "Ждёт проверки"), node("h3", "", submission.homework?.title || "Удалённое задание"), node("p", "", `${submission.student?.name || "Ученик"} · ${formatDate(submission.submittedAt)}`), node("blockquote", "", submission.answer));
    const form = node("form", "review-form");
    const score = document.createElement("input");
    score.type = "number"; score.min = "0"; score.max = "100"; score.required = true; score.value = submission.score ?? 80; score.placeholder = "Оценка";
    const feedback = document.createElement("textarea");
    feedback.rows = 3; feedback.placeholder = "Комментарий ученику"; feedback.value = submission.feedback || "";
    const submit = node("button", "primary-button small", submission.status === "reviewed" ? "Обновить оценку" : "Проверить");
    submit.type = "submit";
    form.append(score, feedback, submit);
    form.addEventListener("submit", (event) => reviewSubmission(event, submission.id, score, feedback));
    item.append(copy, form);
    el.adminSubmissionList.append(item);
  });
}

async function reviewSubmission(event, id, score, feedback) {
  event.preventDefault();
  try {
    await api(`/api/admin/submissions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ score: Number(score.value), feedback: feedback.value }) });
    showToast("Оценка сохранена и добавлена в рейтинг ученика.");
    await loadAdmin();
  } catch (error) { showToast(error.message); }
}

function renderAdminUsers() {
  el.adminUserList.replaceChildren();
  const users = state.admin.users.filter((user) => user.id !== state.user.id);
  if (!users.length) return el.adminUserList.append(emptyState("Зарегистрированных учеников пока нет."));
  users.forEach((user) => {
    const item = node("article", "admin-item user-admin-item");
    const person = node("div", "admin-person");
    person.append(avatar(user.name), node("div", "", ""));
    person.lastChild.append(node("h3", "", user.name), node("p", "", `${user.email} · ${user.stats.trainings} тренировок · ${user.stats.points} очков`));
    const actions = node("div", "admin-actions");
    const role = document.createElement("select");
    [["student", "Ученик"], ["admin", "Администратор"]].forEach(([value, label]) => {
      const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = user.role === value; role.append(option);
    });
    role.addEventListener("change", () => updateUser(user.id, { role: role.value }));
    const block = node("button", user.blocked ? "secondary-button small" : "danger-button", user.blocked ? "Разблокировать" : "Заблокировать");
    block.type = "button";
    block.addEventListener("click", () => updateUser(user.id, { blocked: !user.blocked }));
    actions.append(role, block);
    item.append(person, actions);
    el.adminUserList.append(item);
  });
}

async function updateUser(id, patch) {
  try {
    await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    showToast("Настройки пользователя обновлены.");
    await loadAdmin();
  } catch (error) { showToast(error.message); }
}

function switchAdminTab(tab) {
  $$('[data-admin-tab]').forEach((button) => button.classList.toggle("active", button.dataset.adminTab === tab));
  $$('[data-admin-panel]').forEach((panel) => panel.classList.toggle("hidden", panel.dataset.adminPanel !== tab));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Ошибка сервера (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function node(tag, className = "", text = null) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null && text !== undefined) element.textContent = text;
  return element;
}

function avatar(name) {
  const element = node("span", "avatar", String(name || "У").trim().charAt(0).toUpperCase());
  return element;
}

function emptyState(text) {
  return node("div", "empty-state", text);
}

function scoreClass(score) {
  return score >= 80 ? "score-high" : score >= 60 ? "score-medium" : "score-low";
}

function submissionLabel(submission) {
  return submission.status === "reviewed" ? `Проверено: ${submission.score}/100` : "Отправлено на проверку";
}

function formatDate(value) {
  if (!value) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDueDate(value) {
  if (!value) return "Без срока";
  const date = new Date(`${value}T12:00:00`);
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (days < 0) return `Срок истёк ${formatDate(date)}`;
  if (days === 0) return "Сдать сегодня";
  if (days === 1) return "Сдать завтра";
  return `До ${formatDate(date)}`;
}

function plural(number, one, few, many) {
  const n = Math.abs(Number(number)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}
