/** Копирует текст в буфер: Clipboard API, а без него — скрытый textarea + execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const input = document.createElement('textarea')
    input.value = text
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    try {
      input.select()
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      input.remove()
    }
  }
}
