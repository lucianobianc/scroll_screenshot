const button = document.getElementById('capture');
const stop = document.getElementById('stop');
const status = document.getElementById('status');
const mode = document.getElementById('mode');
const amount = document.getElementById('amount');
mode.addEventListener('change', () => {
  document.getElementById('amount-row').hidden = mode.value === 'end';
  amount.value = mode.value === 'pixels' ? '1500' : '2';
});
const requestStop = () => browser.runtime.sendMessage({ type: 'stop' });
stop.addEventListener('click', requestStop);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && button.disabled) {
    event.preventDefault();
    requestStop();
  }
});
button.addEventListener('click', async () => {
  if (mode.value !== 'end' && !amount.reportValidity()) return;
  button.disabled = true;
  mode.disabled = true;
  amount.disabled = true;
  stop.hidden = false;
  status.textContent = 'Capturando… Esc ou Parar salva o trecho já capturado. Você pode fechar este painel e pressionar Esc na página.';
  try {
    const result = await browser.runtime.sendMessage({ type: 'capture', options: { mode: mode.value, amount: Number(amount.value) } });
    status.textContent = result.error || 'Imagem salva em Downloads.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    mode.disabled = false;
    amount.disabled = false;
    stop.hidden = true;
  }
});
