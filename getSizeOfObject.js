export default (object) => {
  const objectList = [];
  const stack = [object];
  let bytes = 0;

  while (stack.length) {
    const value = stack.pop();

    if (typeof value === 'boolean') {
      bytes += 4;
    } else if (typeof value === 'string') {
      bytes += value.length * 2;
    } else if (typeof value === 'number') {
      bytes += 8;
    } else if (typeof value === 'object' && objectList.indexOf(value) === -1) {
      objectList.push(value);

      for (const i in value) {
        stack.push(value[i]);
      }
    }
  }

  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(3)} KiB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(3)} MiB`;
  return `${(bytes / 1073741824).toFixed(3)} GiB`;
};
