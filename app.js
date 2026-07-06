(function () {
  "use strict";

  const STORAGE_KEY = "task_planner_data";
  const DEFAULT_DATA = {
    schemaVersion: 1,
    tasks: []
  };

  const PRIORITY_LABELS = {
    low: "Низкий",
    medium: "Средний",
    high: "Высокий"
  };

  const EMPTY_MESSAGE = "Задач пока нет. Добавьте первую задачу.";
  const SEARCH_EMPTY_MESSAGE = "По вашему запросу ничего не найдено";
  const GROUP_KEYS = ["overdue", "today", "tomorrow", "upcoming", "completed"];
  const NOTIFICATION_CHECK_INTERVAL = 30000;
  const PRIORITY_ORDER = {
    high: 0,
    medium: 1,
    low: 2
  };

  const elements = {
    addTaskButton: document.querySelector("#add-task-button"),
    modal: document.querySelector("#task-modal"),
    modalTitle: document.querySelector("#task-modal-title"),
    closeModalButton: document.querySelector("#close-modal-button"),
    cancelTaskButton: document.querySelector("#cancel-task-button"),
    exportButton: document.querySelector("#export-button"),
    importButton: document.querySelector("#import-button"),
    importFileInput: document.querySelector("#import-file-input"),
    enableNotificationsButton: document.querySelector("#enable-notifications-button"),
    notificationStatus: document.querySelector("#notification-status"),
    missedRemindersAlert: document.querySelector("#missed-reminders-alert"),
    form: document.querySelector("#task-form"),
    formError: document.querySelector("#form-error"),
    workspace: document.querySelector(".workspace"),
    workspaceEmpty: document.querySelector("#workspace-empty"),
    searchInput: document.querySelector("#search"),
    filterButtons: Array.from(document.querySelectorAll("[data-filter]")),
    taskLists: Array.from(document.querySelectorAll("[data-group]"))
  };

  let plannerData = createDefaultData();
  let editingTaskId = null;
  let activeFilter = "all";
  let notificationTimerId = null;

  function createDefaultData() {
    return {
      schemaVersion: DEFAULT_DATA.schemaVersion,
      tasks: []
    };
  }

  function loadData() {
    try {
      const rawData = localStorage.getItem(STORAGE_KEY);

      if (!rawData) {
        const initialData = createDefaultData();
        saveData(initialData);
        return initialData;
      }

      const parsedData = JSON.parse(rawData);

      if (
        !parsedData ||
        parsedData.schemaVersion !== DEFAULT_DATA.schemaVersion ||
        !Array.isArray(parsedData.tasks)
      ) {
        return createDefaultData();
      }

      return parsedData;
    } catch (error) {
      console.error("Не удалось прочитать данные планировщика.", error);
      return createDefaultData();
    }
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error("Не удалось сохранить данные планировщика.", error);
      alert("Не удалось сохранить данные...");
      return false;
    }
  }

  function normalizeTask(task) {
    const progress = parseInt(task.progress, 10);
    const normalizedProgress = Number.isNaN(progress) ? 0 : Math.min(100, Math.max(0, progress));
    const endAt = task.endAt || task.finishAt || "";
    const reminderMinutes = task.reminderMinutes === undefined ? task.reminder : task.reminderMinutes;
    const normalizedReminderMinutes = reminderMinutes === null || reminderMinutes === undefined || reminderMinutes === "" ?
      null :
      Number(reminderMinutes);

    return {
      ...task,
      endAt,
      finishAt: task.finishAt || endAt,
      reminder: normalizedReminderMinutes,
      reminderMinutes: Number.isNaN(normalizedReminderMinutes) ? null : normalizedReminderMinutes,
      notificationStatus: task.notificationStatus || "not_scheduled",
      progress: normalizedProgress,
      status: normalizedProgress === 100 ? "done" : task.status || "new",
      source: task.source || "local"
    };
  }

  function normalizeData(data) {
    return {
      schemaVersion: DEFAULT_DATA.schemaVersion,
      tasks: data.tasks.map(normalizeTask)
    };
  }

  function openTaskModal(task) {
    clearFormError();
    editingTaskId = task ? task.id : null;
    elements.modalTitle.textContent = task ? "Редактировать задачу" : "Новая задача";

    if (task) {
      fillTaskForm(task);
    } else {
      elements.form.reset();
      elements.form.elements.priority.value = "medium";
      elements.form.elements.reminder.value = "";
    }

    elements.modal.hidden = false;
    elements.form.elements.title.focus();
  }

  function closeTaskModal() {
    elements.modal.hidden = true;
    editingTaskId = null;
    elements.form.reset();
    clearFormError();
  }

  function clearFormError() {
    elements.formError.hidden = true;
    elements.formError.textContent = "";
  }

  function showFormError(message) {
    elements.formError.textContent = message;
    elements.formError.hidden = false;
  }

  function getTrimmedValue(form, fieldName) {
    return form.elements[fieldName].value.trim();
  }

  function parseDateInput(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function toDateTimeLocalValue(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function fillTaskForm(task) {
    elements.form.elements.title.value = task.title || "";
    elements.form.elements.description.value = task.description || "";
    elements.form.elements.startAt.value = toDateTimeLocalValue(task.startAt);
    elements.form.elements.finishAt.value = toDateTimeLocalValue(getTaskEndAt(task));
    elements.form.elements.assigneeRole.value = task.assigneeRole || "";
    elements.form.elements.priority.value = task.priority || "medium";
    elements.form.elements.reminder.value = task.reminderMinutes === null || task.reminderMinutes === undefined ? "" : String(task.reminderMinutes);
  }

  function createTaskFromForm(form) {
    const title = getTrimmedValue(form, "title");
    const description = getTrimmedValue(form, "description");
    const assigneeRole = getTrimmedValue(form, "assigneeRole");
    const startAt = parseDateInput(form.elements.startAt.value);
    const finishAt = parseDateInput(form.elements.finishAt.value);
    const priority = form.elements.priority.value;
    const reminderValue = form.elements.reminder.value;

    if (!title) {
      return {
        error: "Введите название задачи."
      };
    }

    if (title.length > 120) {
      return {
        error: "Название должно быть не длиннее 120 символов."
      };
    }

    if (!startAt || !finishAt) {
      return {
        error: "Укажите старт и финиш задачи."
      };
    }

    if (finishAt < startAt) {
      return {
        error: "Дата финиша не может быть раньше даты старта."
      };
    }

    if (!["low", "medium", "high"].includes(priority)) {
      return {
        error: "Выберите приоритет задачи."
      };
    }

    const now = new Date().toISOString();

    return {
      task: {
        id: generateTaskId(),
        title,
        description,
        startAt: startAt.toISOString(),
        endAt: finishAt.toISOString(),
        finishAt: finishAt.toISOString(),
        assigneeRole,
        priority,
        reminder: reminderValue === "" ? null : Number(reminderValue),
        reminderMinutes: reminderValue === "" ? null : Number(reminderValue),
        notificationStatus: "not_scheduled",
        createdAt: now,
        updatedAt: now,
        progress: 0,
        status: "new",
        source: "local"
      }
    };
  }

  function generateTaskId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createTaskForImport(task, source) {
    const now = new Date().toISOString();

    return normalizeTask({
      ...task,
      id: generateTaskId(),
      createdAt: now,
      updatedAt: now,
      source,
      notificationStatus: task.notificationStatus || "not_scheduled"
    });
  }

  function formatTaskTime(task) {
    const startAt = new Date(task.startAt);
    const finishAt = new Date(getTaskEndAt(task));

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(finishAt.getTime())) {
      return "Время не указано";
    }

    const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
    const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    });

    return `${dateFormatter.format(startAt)}, ${timeFormatter.format(startAt)}-${timeFormatter.format(finishAt)}`;
  }

  function getTaskEndAt(task) {
    return task.endAt || task.finishAt;
  }

  function startOfLocalDay(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addLocalDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function isSameLocalDay(left, right) {
    const leftDay = startOfLocalDay(left);
    const rightDay = startOfLocalDay(right);

    if (!leftDay || !rightDay) {
      return false;
    }

    return leftDay.getTime() === rightDay.getTime();
  }

  function isTaskOverdue(task, now) {
    const endAt = new Date(getTaskEndAt(task));

    if (Number.isNaN(endAt.getTime())) {
      return false;
    }

    return endAt < now && task.progress < 100;
  }

  function getTaskGroup(task, now) {
    if (task.progress === 100) {
      return "completed";
    }

    if (isTaskOverdue(task, now)) {
      return "overdue";
    }

    const today = startOfLocalDay(now);
    const tomorrow = addLocalDays(today, 1);
    const dayAfterTomorrow = addLocalDays(today, 2);
    const startAt = new Date(task.startAt);

    if (Number.isNaN(startAt.getTime())) {
      return "upcoming";
    }

    if (isSameLocalDay(startAt, today)) {
      return "today";
    }

    if (isSameLocalDay(startAt, tomorrow)) {
      return "tomorrow";
    }

    if (startAt >= dayAfterTomorrow) {
      return "upcoming";
    }

    return "upcoming";
  }

  function compareTasks(left, right) {
    const leftPriority = PRIORITY_ORDER[left.priority] ?? PRIORITY_ORDER.medium;
    const rightPriority = PRIORITY_ORDER[right.priority] ?? PRIORITY_ORDER.medium;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftTime = new Date(left.startAt).getTime();
    const rightTime = new Date(right.startAt).getTime();

    return (Number.isNaN(leftTime) ? Number.MAX_SAFE_INTEGER : leftTime) -
      (Number.isNaN(rightTime) ? Number.MAX_SAFE_INTEGER : rightTime);
  }

  function normalizeSearchValue(value) {
    return String(value || "").toLowerCase();
  }

  function matchesSearch(task, query) {
    if (!query) {
      return true;
    }

    const searchableText = [
      task.title,
      task.description,
      task.assignee,
      task.role,
      task.assigneeRole
    ].map(normalizeSearchValue).join(" ");

    return searchableText.includes(query);
  }

  function matchesActiveFilter(task) {
    if (activeFilter === "in-progress") {
      return task.progress > 0 && task.progress < 100;
    }

    if (activeFilter === "high") {
      return task.priority === "high";
    }

    return true;
  }

  function areFiltersActive() {
    return activeFilter !== "all" || elements.searchInput.value.trim() !== "";
  }

  function getFilteredTasks() {
    const query = normalizeSearchValue(elements.searchInput.value.trim());

    return plannerData.tasks.filter((task) => {
      return matchesSearch(task, query) && matchesActiveFilter(task);
    });
  }

  function applyFilters() {
    renderTasks(getFilteredTasks());
    updateFilterButtons();
  }

  function updateFilterButtons() {
    elements.filterButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === activeFilter);
    });
  }

  function createTaskCard(task, groupKey) {
    const card = document.createElement("article");
    card.className = "task-card";
    card.dataset.taskId = task.id;

    if (task.progress === 100) {
      card.classList.add("is-done");
    }

    const title = document.createElement("h3");
    title.className = "task-card-title";
    title.textContent = task.title;

    const meta = document.createElement("p");
    meta.className = "task-card-meta";

    const time = document.createElement("span");
    time.textContent = formatTaskTime(task);

    const priority = document.createElement("span");
    priority.className = `task-pill priority-${task.priority}`;
    priority.textContent = PRIORITY_LABELS[task.priority] || task.priority;

    const role = document.createElement("span");
    role.className = "task-pill";
    role.textContent = task.assigneeRole || "Без ответственного";

    if (task.notificationStatus === "sent") {
      const notificationSent = document.createElement("span");
      notificationSent.className = "task-pill notification-sent";
      notificationSent.textContent = "напоминание отправлено";
      meta.append(notificationSent);
    }

    if (task.notificationStatus === "missed") {
      const notificationMissed = document.createElement("span");
      notificationMissed.className = "task-pill notification-missed";
      notificationMissed.textContent = "напоминание пропущено";
      meta.append(notificationMissed);
    }

    if (groupKey === "overdue") {
      const overdue = document.createElement("span");
      overdue.className = "task-pill task-overdue";
      overdue.textContent = "Просрочено";
      meta.append(overdue);
    }

    meta.append(time, priority, role);

    const progress = document.createElement("div");
    progress.className = "task-progress";

    const progressLabel = document.createElement("label");
    progressLabel.className = "progress-label";
    progressLabel.textContent = "Прогресс";

    const progressValue = document.createElement("span");
    progressValue.className = "progress-value";
    progressValue.textContent = `${task.progress}%`;

    const range = document.createElement("input");
    range.className = "progress-range";
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.value = String(task.progress);
    range.dataset.action = "progress";
    range.setAttribute("aria-label", `Прогресс задачи ${task.title}`);

    progressLabel.append(progressValue);
    progress.append(progressLabel, range);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editButton = document.createElement("button");
    editButton.className = "button button-small";
    editButton.type = "button";
    editButton.dataset.action = "edit";
    editButton.textContent = "Редактировать";

    const duplicateButton = document.createElement("button");
    duplicateButton.className = "button button-small";
    duplicateButton.type = "button";
    duplicateButton.dataset.action = "duplicate";
    duplicateButton.textContent = "Дублировать";

    const shareButton = document.createElement("button");
    shareButton.className = "button button-small";
    shareButton.type = "button";
    shareButton.dataset.action = "share";
    shareButton.textContent = "Поделиться";

    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-small button-danger";
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.textContent = "Удалить";

    actions.append(editButton, duplicateButton, shareButton, deleteButton);
    card.append(title, meta, progress, actions);

    return card;
  }

  function renderEmptyState(container) {
    container.classList.remove("has-tasks");
    container.replaceChildren();

    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = EMPTY_MESSAGE;
    container.append(emptyState);
  }

  function renderTasks(tasksToRender = plannerData.tasks) {
    if (!elements.taskLists.length) {
      return;
    }

    const groupedTasks = GROUP_KEYS.reduce((groups, key) => {
      groups[key] = [];
      return groups;
    }, {});
    const now = new Date();

    tasksToRender.forEach((task) => {
      const groupKey = getTaskGroup(task, now);
      groupedTasks[groupKey].push(task);
    });

    const hasTasksToRender = tasksToRender.length > 0;

    elements.workspaceEmpty.hidden = hasTasksToRender;
    elements.workspaceEmpty.textContent = areFiltersActive() ? SEARCH_EMPTY_MESSAGE : EMPTY_MESSAGE;

    elements.taskLists.forEach((container) => {
      const groupKey = container.dataset.group;
      const tasks = groupedTasks[groupKey] || [];
      const group = container.closest(".task-group");

      container.replaceChildren();
      container.classList.toggle("has-tasks", tasks.length > 0);
      group.hidden = tasks.length === 0;
      updateTaskCount(container, tasks.length);

      if (tasks.length > 0) {
        container.replaceChildren(...tasks.sort(compareTasks).map((task) => createTaskCard(task, groupKey)));
      }
    });
  }

  function updateTaskCount(container, count) {
    const group = container.closest(".task-group");
    const counter = group.querySelector(".task-count");

    counter.textContent = String(count);
  }

  function findTask(taskId) {
    return plannerData.tasks.find((task) => task.id === taskId);
  }

  function saveAndRender() {
    if (saveData(plannerData)) {
      applyFilters();
      return true;
    }

    plannerData = normalizeData(loadData());
    applyFilters();
    return false;
  }

  function getReminderTime(task) {
    if (task.reminderMinutes === null || task.reminderMinutes === undefined) {
      return null;
    }

    const startAt = new Date(task.startAt);

    if (Number.isNaN(startAt.getTime())) {
      return null;
    }

    return new Date(startAt.getTime() - task.reminderMinutes * 60 * 1000);
  }

  function isNotificationCandidate(task) {
    return task.progress < 100 &&
      task.reminderMinutes !== null &&
      task.reminderMinutes !== undefined &&
      ["not_scheduled", "scheduled"].includes(task.notificationStatus);
  }

  function showMissedReminders(count) {
    if (count === 0) {
      elements.missedRemindersAlert.hidden = true;
      elements.missedRemindersAlert.textContent = "";
      return;
    }

    elements.missedRemindersAlert.textContent = `Есть пропущенные напоминания: ${count}`;
    elements.missedRemindersAlert.hidden = false;
  }

  function markMissedReminders() {
    const now = new Date();
    let missedCount = 0;

    plannerData.tasks.forEach((task) => {
      const reminderTime = getReminderTime(task);

      if (isNotificationCandidate(task) && reminderTime && now > reminderTime) {
        task.notificationStatus = "missed";
        task.updatedAt = now.toISOString();
        missedCount += 1;
      }
    });

    if (missedCount > 0) {
      saveData(plannerData);
      applyFilters();
    }

    showMissedReminders(missedCount);
  }

  function updateNotificationIndicator() {
    const statusDot = elements.notificationStatus.querySelector(".status-dot");
    const statusText = elements.notificationStatus.querySelector(".status-text");

    elements.notificationStatus.classList.remove("is-allowed", "is-denied", "is-unsupported", "is-default");

    if (!("Notification" in window)) {
      elements.notificationStatus.classList.add("is-unsupported");
      elements.notificationStatus.setAttribute("aria-label", "Уведомления не поддерживаются");
      statusText.textContent = "Не поддерживаются";
      statusDot.setAttribute("aria-hidden", "true");
      return;
    }

    if (Notification.permission === "granted") {
      elements.notificationStatus.classList.add("is-allowed");
      elements.notificationStatus.setAttribute("aria-label", "Уведомления разрешены");
      statusText.textContent = "Разрешены";
      return;
    }

    if (Notification.permission === "denied") {
      elements.notificationStatus.classList.add("is-denied");
      elements.notificationStatus.setAttribute("aria-label", "Уведомления запрещены");
      statusText.textContent = "Запрещены";
      return;
    }

    elements.notificationStatus.classList.add("is-default");
    elements.notificationStatus.setAttribute("aria-label", "Уведомления не включены");
    statusText.textContent = "Не включены";
  }

  async function requestNotificationsPermission() {
    if (!("Notification" in window)) {
      updateNotificationIndicator();
      return;
    }

    try {
      await Notification.requestPermission();
    } catch (error) {
      console.error("Не удалось запросить разрешение на уведомления.", error);
    }

    updateNotificationIndicator();
  }

  function sendDueNotifications() {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      updateNotificationIndicator();
      return;
    }

    const now = new Date();
    let hasChanges = false;

    plannerData.tasks.forEach((task) => {
      const reminderTime = getReminderTime(task);

      if (!isNotificationCandidate(task) || !reminderTime || now < reminderTime) {
        return;
      }

      new Notification("Напоминание", {
        body: task.title
      });
      task.notificationStatus = "sent";
      task.updatedAt = now.toISOString();
      hasChanges = true;
    });

    if (hasChanges) {
      saveData(plannerData);
      applyFilters();
    }
  }

  function startNotificationTimer() {
    if (notificationTimerId !== null) {
      clearInterval(notificationTimerId);
    }

    notificationTimerId = setInterval(sendDueNotifications, NOTIFICATION_CHECK_INTERVAL);
  }

  function updateProgress(taskId, value, card) {
    const task = findTask(taskId);

    if (!task) {
      return;
    }

    const progress = parseInt(value, 10);
    const normalizedProgress = Number.isNaN(progress) ? 0 : Math.min(100, Math.max(0, progress));
    task.progress = normalizedProgress;
    task.status = normalizedProgress === 100 ? "done" : "in_progress";
    task.updatedAt = new Date().toISOString();

    const progressValue = card.querySelector(".progress-value");
    progressValue.textContent = `${normalizedProgress}%`;
    card.classList.toggle("is-done", normalizedProgress === 100);
    saveAndRender();
  }

  function deleteTask(taskId) {
    if (!confirm("Удалить задачу? Это действие нельзя отменить.")) {
      return;
    }

    plannerData.tasks = plannerData.tasks.filter((task) => task.id !== taskId);
    saveAndRender();
  }

  function duplicateTask(taskId) {
    const task = findTask(taskId);

    if (!task) {
      return;
    }

    const now = new Date().toISOString();
    const copy = {
      ...task,
      id: generateTaskId(),
      title: `${task.title} (копия)`,
      createdAt: now,
      updatedAt: now,
      progress: 0,
      status: "new",
      notificationStatus: "not_scheduled"
    };

    plannerData.tasks.push(copy);
    saveAndRender();
  }

  async function shareTask(taskId) {
    const task = findTask(taskId);

    if (!task) {
      return;
    }

    const sharedTask = {
      ...task
    };

    delete sharedTask.id;
    delete sharedTask.createdAt;
    delete sharedTask.updatedAt;

    const serializedTask = JSON.stringify(sharedTask);
    const hash = btoa(encodeURIComponent(serializedTask));
    const url = `${window.location.origin}${window.location.pathname}?import=${hash}`;

    if (url.length > 2000) {
      alert("Задача слишком большая");
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("Ссылка скопирована");
    } catch (error) {
      console.error("Не удалось скопировать ссылку.", error);
      alert("Не удалось скопировать ссылку.");
    }
  }

  function editTask(taskId) {
    const task = findTask(taskId);

    if (task) {
      openTaskModal(task);
    }
  }

  function handleTaskListInput(event) {
    const action = event.target.dataset.action;

    if (action !== "progress") {
      return;
    }

    const card = event.target.closest(".task-card");

    if (!card) {
      return;
    }

    updateProgress(card.dataset.taskId, event.target.value, card);
  }

  function handleTaskListClick(event) {
    const action = event.target.dataset.action;

    if (!action || action === "progress") {
      return;
    }

    const card = event.target.closest(".task-card");

    if (!card) {
      return;
    }

    if (action === "edit") {
      editTask(card.dataset.taskId);
    }

    if (action === "duplicate") {
      duplicateTask(card.dataset.taskId);
    }

    if (action === "share") {
      shareTask(card.dataset.taskId);
    }

    if (action === "delete") {
      deleteTask(card.dataset.taskId);
    }
  }

  function exportTasks() {
    const blob = new Blob([JSON.stringify(plannerData, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "tasks_backup.json";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importTasksFromBackup(backupData) {
    if (!backupData || !Array.isArray(backupData.tasks)) {
      alert("Не удалось импортировать файл. Неверная структура данных.");
      return false;
    }

    const existingIds = new Set(plannerData.tasks.map((task) => task.id));
    const importedTasks = backupData.tasks.map((task) => {
      const taskToImport = {
        ...task
      };

      if (!taskToImport.id || existingIds.has(taskToImport.id)) {
        taskToImport.id = generateTaskId();
      }

      existingIds.add(taskToImport.id);

      return normalizeTask({
        ...taskToImport,
        source: taskToImport.source || "imported"
      });
    });

    plannerData.tasks.push(...importedTasks);
    saveAndRender();
    return true;
  }

  function importTasksFromFile(file) {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      try {
        const backupData = JSON.parse(String(reader.result || ""));
        importTasksFromBackup(backupData);
      } catch (error) {
        console.error("Не удалось импортировать JSON.", error);
        alert("Не удалось импортировать файл. Проверьте JSON.");
      } finally {
        elements.importFileInput.value = "";
      }
    });

    reader.addEventListener("error", () => {
      alert("Не удалось прочитать файл.");
      elements.importFileInput.value = "";
    });

    reader.readAsText(file);
  }

  function handleImportFileChange(event) {
    const file = event.target.files[0];

    if (file) {
      importTasksFromFile(file);
    }
  }

  function cleanImportUrl() {
    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ""}`;
    history.replaceState(null, document.title, cleanUrl);
  }

  function importTaskFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hash = params.get("import");

    if (!hash) {
      return;
    }

    try {
      const importedTask = JSON.parse(decodeURIComponent(atob(hash)));

      if (!importedTask || typeof importedTask !== "object" || Array.isArray(importedTask)) {
        throw new Error("Invalid task payload");
      }

      if (confirm(`Импортировать задачу: ${importedTask.title || "Без названия"}?`)) {
        plannerData.tasks.push(createTaskForImport(importedTask, "imported"));
        saveData(plannerData);
        applyFilters();
      }
    } catch (error) {
      console.error("Не удалось импортировать задачу из ссылки.", error);
      alert("Не удалось импортировать задачу. Ссылка повреждена.");
    } finally {
      cleanImportUrl();
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    clearFormError();

    const result = createTaskFromForm(elements.form);

    if (result.error) {
      showFormError(result.error);
      return;
    }

    if (editingTaskId) {
      const taskIndex = plannerData.tasks.findIndex((task) => task.id === editingTaskId);

      if (taskIndex === -1) {
        showFormError("Задача для редактирования не найдена.");
        return;
      }

      const currentTask = plannerData.tasks[taskIndex];
      plannerData.tasks[taskIndex] = {
        ...currentTask,
        ...result.task,
        id: currentTask.id,
        createdAt: currentTask.createdAt,
        progress: currentTask.progress,
        status: currentTask.status,
        source: currentTask.source,
        notificationStatus: currentTask.notificationStatus,
        updatedAt: new Date().toISOString()
      };
    } else {
      plannerData.tasks.push(result.task);
    }

    if (!saveData(plannerData)) {
      plannerData = normalizeData(loadData());
      applyFilters();
      return;
    }

    elements.form.reset();
    closeTaskModal();
    applyFilters();
  }

  function handleSearchInput() {
    applyFilters();
  }

  function handleFilterClick(event) {
    const filter = event.target.dataset.filter;

    if (!filter) {
      return;
    }

    activeFilter = filter;
    applyFilters();
  }

  function bindEvents() {
    elements.addTaskButton.addEventListener("click", () => openTaskModal());
    elements.closeModalButton.addEventListener("click", closeTaskModal);
    elements.cancelTaskButton.addEventListener("click", closeTaskModal);
    elements.exportButton.addEventListener("click", exportTasks);
    elements.importButton.addEventListener("click", () => elements.importFileInput.click());
    elements.importFileInput.addEventListener("change", handleImportFileChange);
    elements.enableNotificationsButton.addEventListener("click", requestNotificationsPermission);
    elements.form.addEventListener("submit", handleFormSubmit);
    elements.searchInput.addEventListener("input", handleSearchInput);
    elements.filterButtons.forEach((button) => {
      button.addEventListener("click", handleFilterClick);
    });
    elements.workspace.addEventListener("input", handleTaskListInput);
    elements.workspace.addEventListener("click", handleTaskListClick);
  }

  function init() {
    plannerData = normalizeData(loadData());
    saveData(plannerData);
    bindEvents();
    applyFilters();
    importTaskFromUrl();
    updateNotificationIndicator();
    startNotificationTimer();
    window.addEventListener("load", markMissedReminders);

    if (document.readyState === "complete") {
      markMissedReminders();
    }
  }

  window.taskPlannerStorage = {
    loadData,
    saveData
  };
  window.taskPlannerApp = {
    renderTasks,
    createTaskFromForm,
    getFilteredTasks,
    getTaskGroup,
    startOfLocalDay,
    sendDueNotifications,
    markMissedReminders,
    shareTask,
    exportTasks,
    importTasksFromBackup,
    importTaskFromUrl
  };

  init();
})();
