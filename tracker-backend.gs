// ============================================================
// Бекенд синхронізації для "12 тижнів — трекер цілей"
// ============================================================
// ЯК ПІДКЛЮЧИТИ (одноразово, ~5 хв):
//
// 1. Створи нову Google Таблицю (Google Sheets) — можна порожню,
//    назва не має значення. Вона стане базою даних для трекера.
//
// 2. У таблиці: Розширення (Extensions) -> Apps Script.
//
// 3. Видали весь код-заготовку в редакторі та встав замість нього
//    увесь вміст цього файлу.
//
// 4. Збережи проєкт (значок дискети або Ctrl/Cmd+S).
//
// 5. Розгорнути (Deploy) -> Створити розгортання (New deployment):
//      - Тип (Select type): Веб-додаток (Web app)
//      - Опис: будь-який, наприклад "tracker sync"
//      - Execute as (Виконати як): Me (Я)
//      - Who has access (Хто має доступ): Anyone (Будь-хто)
//    Натисни Deploy. Google попросить авторизувати доступ
//    до власної ж Таблиці — це нормально, підтверди (Advanced ->
//    Go to [назва проєкту] (unsafe), якщо з'явиться попередження —
//    це стандартна поведінка для власних скриптів).
//
// 6. Скопіюй URL веб-додатку (виглядає як
//    https://script.google.com/macros/s/XXXXXXXX/exec).
//
// 7. Відкрий tracker HTML -> меню (три крапки) -> "Налаштувати
//    синхронізацію" -> встав цей URL. Готово — тепер і на
//    телефоні, і на комп'ютері трекер читає/пише в цю ж Таблицю.
//
// Якщо пізніше зміниш код цього скрипта — обов'язково зроби
// Deploy -> Manage deployments -> редагувати (олівець) -> New version,
// інакше зміни не застосуються до вже виданого URL.
// ============================================================

const SHEET_NAME = 'data';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['key', 'value']);
  }
  return sheet;
}

function findRow_(sheet, key) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return i + 1; // номер рядка (1-indexed)
  }
  return -1;
}

// GET-запити: ?action=get&key=week:1  |  ?action=getall  |  ?action=list
function doGet(e) {
  const sheet = getSheet_();
  const action = (e.parameter.action || 'get');

  // Віддає ВСІ пари ключ-значення одним запитом. Саме це використовує
  // трекер при відкритті — раніше він робив 13 окремих запитів поспіль,
  // через що сторінка вантажилась ~20 секунд.
  if (action === 'getall') {
    const data = sheet.getDataRange().getValues();
    const items = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) items[data[i][0]] = data[i][1];
    }
    return jsonOut_({ items: items });
  }

  if (action === 'list') {
    const data = sheet.getDataRange().getValues();
    const keys = [];
    for (let i = 1; i < data.length; i++) keys.push(data[i][0]);
    return jsonOut_({ keys: keys });
  }

  const key = e.parameter.key;
  const row = findRow_(sheet, key);
  if (row === -1) return jsonOut_({ key: key, value: null });
  const value = sheet.getRange(row, 2).getValue();
  return jsonOut_({ key: key, value: value });
}

// POST-запити: тіло {"action":"set","key":"week:1","value":"..."}
//          або {"action":"delete","key":"week:1"}
function doPost(e) {
  const sheet = getSheet_();
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  const key = body.key;

  if (action === 'delete') {
    const row = findRow_(sheet, key);
    if (row !== -1) sheet.deleteRow(row);
    return jsonOut_({ key: key, deleted: true });
  }

  // action === 'set'
  const value = body.value;
  const row = findRow_(sheet, key);
  if (row === -1) {
    sheet.appendRow([key, value]);
  } else {
    sheet.getRange(row, 2).setValue(value);
  }
  return jsonOut_({ key: key, value: value });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
