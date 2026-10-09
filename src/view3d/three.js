/* three.js подгружается отдельным куском только при входе в 3D; модули 3D берут THREE отсюда (живая привязка: после loadThree — загружен) */
let THREE = null;
async function loadThree() {
  if (!THREE) THREE = await import('three');
  return THREE;
}

export { THREE, loadThree };
