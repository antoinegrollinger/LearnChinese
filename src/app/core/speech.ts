/** Pronounces Chinese text with the system's Chinese voice, if there is one. */
export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.75;
  const voice = speechSynthesis
    .getVoices()
    .find((v) => v.lang.replace('_', '-').startsWith('zh-CN'));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
