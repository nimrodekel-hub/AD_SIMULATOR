/**
 * Preparing reference screenshots in the browser, before they are uploaded.
 *
 * A phone screenshot is two to four megabytes, and a handful of them exceed the
 * serverless request limit long before they exceed anything useful. They are
 * also far larger than the model will ever look at: images are resized to fit
 * 1568px on the long edge before they are read, so everything above that is
 * uploaded, paid for, and then thrown away.
 *
 * Scaling here rather than raising a limit is therefore not a compromise. The
 * model sees the same picture either way; only the transfer gets smaller.
 *
 * What the console builder needs from a screenshot is layout, density, palette
 * and typography — none of which live in the pixels a downscale removes.
 */

/** What the model resizes to anyway. Sending more is pure waste. */
const MAX_EDGE = 1568;

/** High enough that panel edges and thin rules stay crisp. */
const QUALITY = 0.85;

export interface PreparedImage {
  file: File;
  originalBytes: number;
}

/**
 * Returns a smaller version of the image, or the original when it cannot be
 * read.
 *
 * A format the browser cannot decode — an unusual HEIC, a corrupt file — must
 * not stop the upload: the server still accepts it, and the size guard still
 * applies. Failing soft keeps a rare file from blocking a common task.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    // Already small enough: re-encoding would only lose detail.
    if (scale === 1 && file.size <= 600 * 1024) {
      bitmap.close();
      return { file, originalBytes: file.size };
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return { file, originalBytes: file.size };
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) {
      // A screenshot of flat panels can compress worse as JPEG than as the
      // original PNG. Keep whichever is actually smaller.
      return { file, originalBytes: file.size };
    }

    return {
      file: new File([blob], renameToJpeg(file.name), { type: "image/jpeg" }),
      originalBytes: file.size,
    };
  } catch {
    return { file, originalBytes: file.size };
  }
}

function renameToJpeg(name: string): string {
  return `${name.replace(/\.[^.]+$/, "")}.jpg`;
}
