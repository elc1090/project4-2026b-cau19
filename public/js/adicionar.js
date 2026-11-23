// ============================================================
// ADICIONAR (e EDITAR) QUESTÃO
// ============================================================
// Fluxo: imagem -> "Processar com IA" -> formulário preenchido -> usuário revisa -> salvar.
// Esta mesma página edita questões: adicionar.html?editar=12

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const editId = Number(new URLSearchParams(window.location.search).get('editar')) || null;

const uploadSection = document.getElementById('upload-section');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const preview = document.getElementById('preview');
const dropzoneEmpty = document.getElementById('dropzone-empty');
const processButton = document.getElementById('process-button');
const processStatus = document.getElementById('process-status');
const form = document.getElementById('question-form');
const alternativesBox = document.getElementById('alternatives');
const addAlternativeButton = document.getElementById('add-alternative');
const aiNotice = document.getElementById('ai-notice');
const formError = document.getElementById('form-error');
const saveButton = document.getElementById('save-button');

let selectedFile = null;

function showStatus(text, type = '', loading = false) {
  processStatus.className = `status ${type}`;
  processStatus.innerHTML = (loading ? '<span class="spinner"></span> ' : '') + escapeHtml(text);
}

// ============================================================
// ESCOLHA DA IMAGEM (clique, arrastar ou colar)
// ============================================================
function setFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showStatus('Escolha uma imagem PNG, JPG ou WEBP.', 'error');
    return;
  }
  selectedFile = file;
  preview.src = URL.createObjectURL(file); // mostra a imagem sem enviar nada ainda
  preview.hidden = false;
  dropzoneEmpty.hidden = true;
  processButton.disabled = false;
  showStatus('');
}

fileInput.addEventListener('change', () => setFile(fileInput.files[0]));

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault(); // sem isso o navegador abriria a imagem em outra aba
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  setFile(event.dataTransfer.files[0]);
});

// Ctrl+V com um print copiado
document.addEventListener('paste', (event) => {
  if (uploadSection.hidden) return;
  const file = [...event.clipboardData.files].find((f) => f.type.startsWith('image/'));
  if (file) setFile(file);
});

// Reduz a imagem no navegador antes de enviar (fotos de celular podem ter 10 MB ou mais).
// Desenha num <canvas> menor e exporta como JPEG. O resultado é uma "data URL" (texto base64).
function resizeImage(file) {
  const MAX_PIXELS = 3000000; // ~3 megapixels: texto continua legível e o arquivo fica pequeno
  const MAX_SIDE = 3000;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (img.width * img.height)), MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // fundo branco (PNG transparente ficaria preto no JPEG)
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
    img.src = URL.createObjectURL(file);
  });
}

processButton.addEventListener('click', async () => {
  processButton.disabled = true;
  showStatus('Lendo a questão com IA... isso pode levar alguns segundos.', '', true);
  try {
    const image = await resizeImage(selectedFile);
    const result = await api('/api/questions/extract', { method: 'POST', body: { image } });

    if (!result.found) {
      showStatus('A IA não encontrou uma questão legível nesta imagem. Tente outro print ou preencha manualmente.', 'error');
      return;
    }

    fillForm({ ...result, is_shared: false });
    aiNotice.textContent = 'Confira tudo antes de salvar: a IA pode errar na transcrição ou na classificação.'
      + (result.correct_letter ? '' : ' O gabarito não aparece na imagem, por isso ficou como "Não informado".');
    aiNotice.hidden = false;
    showForm();
    showStatus('Pronto! Revise o formulário abaixo.', 'ok');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    processButton.disabled = false;
  }
});

document.getElementById('manual-button').addEventListener('click', () => {
  if (form.hidden) fillForm({});
  aiNotice.hidden = true;
  showForm();
  form.elements.statement.focus();
});

// ============================================================
// FORMULÁRIO
// ============================================================
function showForm() {
  form.hidden = false;
}

// Cria uma linha de alternativa (letra + texto + botão remover)
function addAlternative(text = '') {
  if (alternativesBox.children.length >= 5) return;
  const row = document.createElement('div');
  row.className = 'alt-row';
  row.innerHTML = `
    <span class="alt-letter"></span>
    <textarea rows="2" maxlength="3000" aria-label="Texto da alternativa"></textarea>
    <button type="button" class="btn btn-ghost btn-small" data-remove title="Remover alternativa">✕</button>`;
  row.querySelector('textarea').value = text;
  alternativesBox.appendChild(row);
  refreshLetters();
}

// Refaz as letras (A, B, C...) e as opções do gabarito depois de adicionar/remover
function refreshLetters() {
  const rows = [...alternativesBox.children];
  rows.forEach((row, i) => {
    row.querySelector('.alt-letter').textContent = LETTERS[i];
    row.querySelector('[data-remove]').disabled = rows.length <= 2;
  });

  const select = form.elements.correct_letter;
  const previous = select.value;
  select.innerHTML = '<option value="">Não informado</option>'
    + rows.map((_, i) => `<option value="${LETTERS[i]}">${LETTERS[i]}</option>`).join('');
  if (LETTERS.indexOf(previous) < rows.length) select.value = previous;

  addAlternativeButton.disabled = rows.length >= 5;
}

addAlternativeButton.addEventListener('click', () => addAlternative());

alternativesBox.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove]');
  if (removeButton && alternativesBox.children.length > 2) {
    removeButton.closest('.alt-row').remove();
    refreshLetters();
  }
});

// Preenche o formulário com os dados de uma questão (da IA ou do banco, na edição)
function fillForm(question) {
  const fields = form.elements;
  fields.statement.value = question.statement || '';

  alternativesBox.innerHTML = '';
  const texts = question.alternatives?.length ? question.alternatives : ['', ''];
  texts.forEach((text) => addAlternative(text));
  while (alternativesBox.children.length < 2) addAlternative('');

  fields.correct_letter.value = question.correct_letter || '';
  fields.source.value = question.source || '';
  fields.area.value = question.area || '';
  fields.discipline.value = question.discipline || '';
  fields.subject.value = question.subject || '';
  fields.subsubject.value = question.subsubject || '';
  fields.explanation.value = question.explanation || '';
  fields.is_shared.checked = Boolean(question.is_shared);
}

function readForm() {
  const fields = form.elements;
  return {
    statement: fields.statement.value,
    alternatives: [...alternativesBox.querySelectorAll('textarea')].map((textarea) => textarea.value),
    correct_letter: fields.correct_letter.value || null,
    source: fields.source.value,
    area: fields.area.value,
    discipline: fields.discipline.value,
    subject: fields.subject.value,
    subsubject: fields.subsubject.value,
    explanation: fields.explanation.value,
    is_shared: fields.is_shared.checked,
  };
}

// Salvar: quem valida de verdade é o servidor; se algo estiver errado, a mensagem dele aparece aqui
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  saveButton.disabled = true;
  try {
    const body = readForm();
    const result = editId
      ? await api(`/api/questions/${editId}`, { method: 'PUT', body })
      : await api('/api/questions', { method: 'POST', body });
    showSaved(result.id);
  } catch (error) {
    formError.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

function showSaved(id) {
  uploadSection.hidden = true;
  form.hidden = true;
  document.getElementById('saved-section').hidden = false;
  document.getElementById('saved-title').textContent = editId ? 'Alterações salvas!' : 'Questão salva!';
  document.getElementById('solve-link').href = `/questoes.html?id=${id}`;
  window.scrollTo(0, 0);
}

// Sugestões (datalist) com os nomes de classificação que já existem
async function loadSuggestions() {
  const options = await api('/api/questions/filters');
  const fill = (id, values) => {
    document.getElementById(id).innerHTML = [...new Set(values)]
      .map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
  };
  fill('areas-list', options.map((o) => o.area));
  fill('disciplines-list', options.map((o) => o.discipline));
  fill('subjects-list', options.map((o) => o.subject));
}

// ============================================================
// INÍCIO
// ============================================================
async function init() {
  if (editId) document.body.dataset.page = 'minhas'; // na edição, o menu destaca "Minhas questões"
  await initPage();
  loadSuggestions().catch(() => {}); // se falhar, só fica sem sugestões

  if (editId) {
    // Modo edição: busca a questão completa (só funciona para o autor)
    document.title = 'Editar questão · Gabarito';
    document.getElementById('page-title').textContent = 'Editar questão';
    document.getElementById('page-subtitle').textContent = 'Altere o que precisar e salve.';
    uploadSection.hidden = true;
    saveButton.textContent = 'Salvar alterações';
    const question = await api(`/api/me/questions/${editId}`);
    fillForm(question);
    showForm();
  } else {
    fillForm({});
  }
}

init().catch(showPageError);
