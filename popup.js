const button = document.getElementById('capture');
const status = document.getElementById('status');
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Capturing… Keep this tab visible.';
  try {
    const result = await browser.runtime.sendMessage({ type: 'capture' });
    status.textContent = result.error || 'Screenshot saved to your downloads.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
