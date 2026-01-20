"use client";

import { useCachedImage } from "@/hooks/useCachedImage";
import { ImageProps } from "next/image";
import { memo } from "react";

interface CachedImageProps extends Omit<ImageProps, 'src'> {
    src: string | null | undefined;
    fill?: boolean;
}

/**
 * Image component that uses client-side caching to prevent reloading
 * Uses blob URLs to persist images across re-renders
 */
import Image from "next/image";

const CachedImage = memo(function CachedImage({ src, alt = "", ...props }: CachedImageProps) {
    const cachedSrc = useCachedImage(src || null);

    if (!cachedSrc) {
        return null;
    }

    return <Image src={cachedSrc} alt={alt} {...props} />;
});

export { CachedImage };
