// A validity mask describes source pixels, independently of portrait/PNG alpha.
// The mask is rotated with the decoded image; transparent rotation corners are 0.
const VALID_PIXEL_THRESHOLD = 128;

function rectangularRatios(image, crop) {
  return {
    top: Math.max(0, -crop.top) / crop.height,
    bottom: Math.max(0, crop.top + crop.height - image.height) / crop.height,
    left: Math.max(0, -crop.left) / crop.width,
    right: Math.max(0, crop.left + crop.width - image.width) / crop.width
  };
}

function cropInvalidRatios(image, crop) {
  const rectangular = rectangularRatios(image, crop);
  const mask = image.validity;
  if (!mask) return rectangular;
  const { width, height } = image;
  if (mask.length !== width * height) throw new Error('有效像素蒙版尺寸无效');
  // Preserve the original continuous geometry exactly, even for fractional crop
  // edges and simultaneous horizontal/vertical overflow. Do not rasterize it.
  if (mask.every(value => value === 255)) return rectangular;

  const firstY = new Int32Array(width).fill(height);
  const lastY = new Int32Array(width).fill(-1);
  const firstX = new Int32Array(height).fill(width);
  const lastX = new Int32Array(height).fill(-1);
  let validCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] < VALID_PIXEL_THRESHOLD) continue;
      firstY[x] = Math.min(firstY[x], y);
      lastY[x] = y;
      firstX[y] = Math.min(firstX[y], x);
      lastX[y] = x;
      validCount++;
    }
  }
  if (!validCount) return { top: 1, bottom: 1, left: 1, right: 1 };

  const left = Math.max(0, crop.left);
  const right = Math.min(width, crop.left + crop.width);
  const top = Math.max(0, crop.top);
  const bottom = Math.min(height, crop.top + crop.height);
  let topDepth = 0, bottomDepth = 0, columnWeight = 0;
  let leftDepth = 0, rightDepth = 0, rowWeight = 0;

  // Average directional penetration, weighted by exact pixel-cell overlap with
  // the floating-point crop. This counts triangular rotation corners by their
  // area rather than allowing one corner pixel to dictate the entire edge.
  // A column with no source support anywhere belongs to side overflow; likewise
  // an unsupported row belongs to vertical overflow. Excluding these prevents
  // the same full-width/full-height external strip contaminating both axes.
  for (let x = Math.max(0, Math.floor(left)); x < Math.ceil(right); x++) {
    if (lastY[x] < 0) continue;
    const weight = Math.max(0, Math.min(right, x + 1) - Math.max(left, x));
    topDepth += weight * Math.max(0, Math.min(bottom, firstY[x]) - top);
    bottomDepth += weight * Math.max(0, bottom - Math.max(top, lastY[x] + 1));
    columnWeight += weight;
  }
  for (let y = Math.max(0, Math.floor(top)); y < Math.ceil(bottom); y++) {
    if (lastX[y] < 0) continue;
    const weight = Math.max(0, Math.min(bottom, y + 1) - Math.max(top, y));
    leftDepth += weight * Math.max(0, Math.min(right, firstX[y]) - left);
    rightDepth += weight * Math.max(0, right - Math.max(left, lastX[y] + 1));
    rowWeight += weight;
  }
  // Empty support on both axes means that the crop cannot contain source data.
  if (!columnWeight && !rowWeight) return { top: 1, bottom: 1, left: 1, right: 1 };
  // External canvas overflow remains continuous and is counted exactly once.
  // This statistic assumes a convex source rectangle rotated in the plane;
  // interior holes in arbitrary masks are not an edge-overflow measurement.
  return {
    top: rectangular.top + (columnWeight ? topDepth / columnWeight / crop.height : 0),
    bottom: rectangular.bottom + (columnWeight ? bottomDepth / columnWeight / crop.height : 0),
    left: rectangular.left + (rowWeight ? leftDepth / rowWeight / crop.width : 0),
    right: rectangular.right + (rowWeight ? rightDepth / rowWeight / crop.width : 0)
  };
}

module.exports = { VALID_PIXEL_THRESHOLD, cropInvalidRatios };
