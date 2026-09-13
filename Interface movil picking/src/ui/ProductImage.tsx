import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { hueFrom } from "@/lib/format";

interface ProductImageProps {
  uri?: string | null;
  /** Semilla para el color del placeholder (sku o nombre). */
  seed: string;
  size: number;
}

/** Miniatura del producto; si no hay imagen, un placeholder con color por hash. */
export function ProductImage({ uri, seed, size }: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  const hue = hueFrom(seed);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.img, { width: size, height: size }]}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={[
        styles.img,
        {
          width: size,
          height: size,
          backgroundColor: `hsl(${hue}, 45%, 20%)`,
          borderWidth: 1,
          borderColor: `hsl(${hue}, 45%, 34%)`,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  img: { borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)" },
});
