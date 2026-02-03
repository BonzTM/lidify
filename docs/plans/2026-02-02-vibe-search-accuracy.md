# Enhanced Vibe Search Accuracy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve vibe search accuracy by adding vocabulary-based query expansion and audio feature re-ranking, so genre searches like "electronic" return genre-appropriate results instead of acoustically-similar but genre-mismatched tracks.

**Architecture:** Pre-compute CLAP text embeddings for ~150 genre/mood/vibe terms with associated audio feature profiles. At search time, expand user queries by finding similar vocabulary terms, then re-rank CLAP results using audio features with dynamic weighting based on genre confidence.

**Tech Stack:** TypeScript, CLAP embeddings (existing), PostgreSQL audio features (existing), Redis pub/sub (existing)

---

## Task 1: Create Feature Profile Research Data

**Files:**
- Create: `backend/src/data/featureProfiles.ts`

**Step 1: Create the feature profiles module**

```typescript
// backend/src/data/featureProfiles.ts

/**
 * Research-based audio feature profiles for genres, moods, and vibes.
 * Values are target ranges (0-1) based on academic literature on music information retrieval.
 *
 * Sources:
 * - Tzanetakis & Cook (2002) - Musical genre classification
 * - Laurier et al. (2008) - Audio music mood classification
 * - Spotify Audio Features documentation
 */

export interface FeatureProfile {
    energy?: number;
    valence?: number;
    danceability?: number;
    acousticness?: number;
    instrumentalness?: number;
    arousal?: number;
    speechiness?: number;
}

export type TermType = "genre" | "mood" | "vibe" | "descriptor";

export interface VocabTermDefinition {
    type: TermType;
    featureProfile: FeatureProfile;
    related?: string[];
}

export const VOCAB_DEFINITIONS: Record<string, VocabTermDefinition> = {
    // === GENRES ===
    electronic: {
        type: "genre",
        featureProfile: { instrumentalness: 0.7, acousticness: 0.15, danceability: 0.7, energy: 0.65 },
        related: ["synth", "edm", "techno", "house", "trance"]
    },
    techno: {
        type: "genre",
        featureProfile: { instrumentalness: 0.85, acousticness: 0.1, danceability: 0.8, energy: 0.75 },
        related: ["electronic", "house", "minimal"]
    },
    house: {
        type: "genre",
        featureProfile: { instrumentalness: 0.6, acousticness: 0.1, danceability: 0.85, energy: 0.7 },
        related: ["electronic", "disco", "dance"]
    },
    trance: {
        type: "genre",
        featureProfile: { instrumentalness: 0.8, acousticness: 0.1, danceability: 0.75, energy: 0.7, arousal: 0.65 },
        related: ["electronic", "edm"]
    },
    ambient: {
        type: "genre",
        featureProfile: { instrumentalness: 0.9, acousticness: 0.4, energy: 0.2, arousal: 0.2, danceability: 0.15 },
        related: ["electronic", "atmospheric", "chill"]
    },
    trap: {
        type: "genre",
        featureProfile: { instrumentalness: 0.3, acousticness: 0.1, danceability: 0.7, energy: 0.7 },
        related: ["hip-hop", "rap", "electronic"]
    },
    "hip-hop": {
        type: "genre",
        featureProfile: { instrumentalness: 0.2, acousticness: 0.15, danceability: 0.75, speechiness: 0.3 },
        related: ["rap", "trap", "r&b"]
    },
    rock: {
        type: "genre",
        featureProfile: { instrumentalness: 0.3, acousticness: 0.25, energy: 0.75, danceability: 0.5 },
        related: ["alternative", "indie", "punk"]
    },
    metal: {
        type: "genre",
        featureProfile: { instrumentalness: 0.4, acousticness: 0.05, energy: 0.95, arousal: 0.9, valence: 0.3 },
        related: ["heavy", "hard rock"]
    },
    punk: {
        type: "genre",
        featureProfile: { instrumentalness: 0.2, acousticness: 0.2, energy: 0.9, danceability: 0.5, valence: 0.5 },
        related: ["rock", "alternative"]
    },
    jazz: {
        type: "genre",
        featureProfile: { instrumentalness: 0.6, acousticness: 0.7, danceability: 0.5, energy: 0.4 },
        related: ["blues", "soul", "swing"]
    },
    blues: {
        type: "genre",
        featureProfile: { instrumentalness: 0.4, acousticness: 0.65, valence: 0.35, energy: 0.45 },
        related: ["jazz", "soul", "rock"]
    },
    classical: {
        type: "genre",
        featureProfile: { instrumentalness: 0.95, acousticness: 0.9, speechiness: 0.05, danceability: 0.25 },
        related: ["orchestral", "piano", "instrumental"]
    },
    folk: {
        type: "genre",
        featureProfile: { instrumentalness: 0.3, acousticness: 0.85, energy: 0.35, danceability: 0.4 },
        related: ["acoustic", "country", "indie"]
    },
    country: {
        type: "genre",
        featureProfile: { instrumentalness: 0.25, acousticness: 0.6, valence: 0.6, danceability: 0.55 },
        related: ["folk", "americana"]
    },
    "r&b": {
        type: "genre",
        featureProfile: { instrumentalness: 0.2, acousticness: 0.3, danceability: 0.7, valence: 0.55 },
        related: ["soul", "hip-hop", "funk"]
    },
    soul: {
        type: "genre",
        featureProfile: { instrumentalness: 0.25, acousticness: 0.45, valence: 0.5, energy: 0.5 },
        related: ["r&b", "funk", "gospel"]
    },
    funk: {
        type: "genre",
        featureProfile: { instrumentalness: 0.35, acousticness: 0.3, danceability: 0.85, energy: 0.7 },
        related: ["soul", "disco", "groove"]
    },
    disco: {
        type: "genre",
        featureProfile: { instrumentalness: 0.3, acousticness: 0.2, danceability: 0.9, energy: 0.75, valence: 0.8 },
        related: ["funk", "house", "dance"]
    },
    pop: {
        type: "genre",
        featureProfile: { instrumentalness: 0.15, acousticness: 0.3, danceability: 0.7, valence: 0.65 },
        related: ["dance", "synth"]
    },
    indie: {
        type: "genre",
        featureProfile: { instrumentalness: 0.35, acousticness: 0.5, energy: 0.55, danceability: 0.5 },
        related: ["alternative", "rock", "folk"]
    },
    alternative: {
        type: "genre",
        featureProfile: { instrumentalness: 0.3, acousticness: 0.4, energy: 0.6, danceability: 0.5 },
        related: ["indie", "rock"]
    },
    reggae: {
        type: "genre",
        featureProfile: { instrumentalness: 0.3, acousticness: 0.4, danceability: 0.75, valence: 0.65, energy: 0.5 },
        related: ["dub", "ska"]
    },
    dubstep: {
        type: "genre",
        featureProfile: { instrumentalness: 0.6, acousticness: 0.05, energy: 0.85, danceability: 0.65 },
        related: ["electronic", "bass"]
    },
    dnb: {
        type: "genre",
        featureProfile: { instrumentalness: 0.7, acousticness: 0.05, energy: 0.9, danceability: 0.7 },
        related: ["electronic", "jungle", "bass"]
    },
    lofi: {
        type: "genre",
        featureProfile: { instrumentalness: 0.7, acousticness: 0.4, energy: 0.3, arousal: 0.3, danceability: 0.4 },
        related: ["chill", "hip-hop", "ambient"]
    },

    // === MOODS ===
    happy: {
        type: "mood",
        featureProfile: { valence: 0.85, energy: 0.7, arousal: 0.6, danceability: 0.7 },
        related: ["upbeat", "cheerful", "joyful"]
    },
    sad: {
        type: "mood",
        featureProfile: { valence: 0.2, energy: 0.3, arousal: 0.3, danceability: 0.3 },
        related: ["melancholic", "somber", "blue"]
    },
    melancholic: {
        type: "mood",
        featureProfile: { valence: 0.25, energy: 0.35, arousal: 0.4, acousticness: 0.5 },
        related: ["sad", "nostalgic", "bittersweet"]
    },
    angry: {
        type: "mood",
        featureProfile: { valence: 0.25, energy: 0.9, arousal: 0.9 },
        related: ["aggressive", "intense", "heavy"]
    },
    aggressive: {
        type: "mood",
        featureProfile: { valence: 0.3, energy: 0.9, arousal: 0.85 },
        related: ["angry", "intense", "heavy"]
    },
    peaceful: {
        type: "mood",
        featureProfile: { valence: 0.6, energy: 0.2, arousal: 0.2, acousticness: 0.6 },
        related: ["calm", "serene", "tranquil"]
    },
    calm: {
        type: "mood",
        featureProfile: { energy: 0.25, arousal: 0.25, valence: 0.55 },
        related: ["peaceful", "relaxed", "serene"]
    },
    anxious: {
        type: "mood",
        featureProfile: { valence: 0.3, arousal: 0.75, energy: 0.6 },
        related: ["tense", "nervous"]
    },
    romantic: {
        type: "mood",
        featureProfile: { valence: 0.6, energy: 0.4, acousticness: 0.5, arousal: 0.45 },
        related: ["love", "intimate", "sensual"]
    },
    hopeful: {
        type: "mood",
        featureProfile: { valence: 0.7, energy: 0.55, arousal: 0.5 },
        related: ["uplifting", "optimistic", "bright"]
    },
    nostalgic: {
        type: "mood",
        featureProfile: { valence: 0.45, energy: 0.4, arousal: 0.4 },
        related: ["melancholic", "bittersweet", "wistful"]
    },
    dark: {
        type: "mood",
        featureProfile: { valence: 0.2, energy: 0.5, acousticness: 0.3, arousal: 0.5 },
        related: ["brooding", "ominous", "moody"]
    },
    bright: {
        type: "mood",
        featureProfile: { valence: 0.8, energy: 0.65, arousal: 0.6 },
        related: ["happy", "cheerful", "sunny"]
    },

    // === VIBES ===
    chill: {
        type: "vibe",
        featureProfile: { energy: 0.3, arousal: 0.3, valence: 0.55, danceability: 0.45 },
        related: ["relaxed", "mellow", "laid-back"]
    },
    relaxed: {
        type: "vibe",
        featureProfile: { energy: 0.25, arousal: 0.25, valence: 0.5 },
        related: ["chill", "calm", "peaceful"]
    },
    energetic: {
        type: "vibe",
        featureProfile: { energy: 0.85, arousal: 0.8, danceability: 0.75 },
        related: ["upbeat", "powerful", "driving"]
    },
    upbeat: {
        type: "vibe",
        featureProfile: { energy: 0.75, valence: 0.75, danceability: 0.7 },
        related: ["energetic", "happy", "cheerful"]
    },
    groovy: {
        type: "vibe",
        featureProfile: { danceability: 0.85, energy: 0.65, valence: 0.6 },
        related: ["funky", "rhythmic", "danceable"]
    },
    dreamy: {
        type: "vibe",
        featureProfile: { energy: 0.35, arousal: 0.35, acousticness: 0.5, instrumentalness: 0.5 },
        related: ["ethereal", "atmospheric", "ambient"]
    },
    ethereal: {
        type: "vibe",
        featureProfile: { energy: 0.3, instrumentalness: 0.6, acousticness: 0.45, arousal: 0.35 },
        related: ["dreamy", "atmospheric", "ambient"]
    },
    atmospheric: {
        type: "vibe",
        featureProfile: { instrumentalness: 0.7, energy: 0.4, acousticness: 0.4 },
        related: ["ambient", "ethereal", "cinematic"]
    },
    intense: {
        type: "vibe",
        featureProfile: { energy: 0.85, arousal: 0.85, valence: 0.4 },
        related: ["powerful", "aggressive", "dramatic"]
    },
    playful: {
        type: "vibe",
        featureProfile: { valence: 0.75, energy: 0.65, danceability: 0.7 },
        related: ["fun", "quirky", "whimsical"]
    },
    brooding: {
        type: "vibe",
        featureProfile: { valence: 0.25, energy: 0.45, arousal: 0.5 },
        related: ["dark", "moody", "introspective"]
    },
    cinematic: {
        type: "vibe",
        featureProfile: { instrumentalness: 0.8, energy: 0.5, acousticness: 0.5 },
        related: ["epic", "dramatic", "orchestral"]
    },
    epic: {
        type: "vibe",
        featureProfile: { energy: 0.75, arousal: 0.7, instrumentalness: 0.6 },
        related: ["cinematic", "dramatic", "powerful"]
    },
    mellow: {
        type: "vibe",
        featureProfile: { energy: 0.3, arousal: 0.3, valence: 0.5, acousticness: 0.5 },
        related: ["chill", "relaxed", "soft"]
    },
    funky: {
        type: "vibe",
        featureProfile: { danceability: 0.85, energy: 0.7, valence: 0.65 },
        related: ["groovy", "rhythmic"]
    },
    hypnotic: {
        type: "vibe",
        featureProfile: { instrumentalness: 0.7, danceability: 0.6, energy: 0.5, arousal: 0.5 },
        related: ["trance", "repetitive", "mesmerizing"]
    },

    // === DESCRIPTORS ===
    fast: {
        type: "descriptor",
        featureProfile: { energy: 0.8, danceability: 0.7 },
        related: ["energetic", "upbeat"]
    },
    slow: {
        type: "descriptor",
        featureProfile: { energy: 0.3, danceability: 0.35 },
        related: ["chill", "relaxed"]
    },
    heavy: {
        type: "descriptor",
        featureProfile: { energy: 0.85, acousticness: 0.15 },
        related: ["intense", "aggressive", "metal"]
    },
    soft: {
        type: "descriptor",
        featureProfile: { energy: 0.25, acousticness: 0.6 },
        related: ["gentle", "quiet", "mellow"]
    },
    loud: {
        type: "descriptor",
        featureProfile: { energy: 0.85 },
        related: ["intense", "powerful"]
    },
    acoustic: {
        type: "descriptor",
        featureProfile: { acousticness: 0.9, instrumentalness: 0.4 },
        related: ["unplugged", "folk"]
    },
    vocal: {
        type: "descriptor",
        featureProfile: { instrumentalness: 0.1, speechiness: 0.2 },
        related: ["singing", "lyrics"]
    },
    instrumental: {
        type: "descriptor",
        featureProfile: { instrumentalness: 0.9, speechiness: 0.05 },
        related: ["no vocals"]
    },
    danceable: {
        type: "descriptor",
        featureProfile: { danceability: 0.85, energy: 0.7 },
        related: ["groovy", "rhythmic"]
    },
    synth: {
        type: "descriptor",
        featureProfile: { acousticness: 0.1, instrumentalness: 0.5 },
        related: ["electronic", "synthesizer"]
    },
    bass: {
        type: "descriptor",
        featureProfile: { energy: 0.7, acousticness: 0.1 },
        related: ["heavy", "dubstep", "dnb"]
    },
    guitar: {
        type: "descriptor",
        featureProfile: { acousticness: 0.5 },
        related: ["rock", "folk", "blues"]
    },
    piano: {
        type: "descriptor",
        featureProfile: { acousticness: 0.7, instrumentalness: 0.6 },
        related: ["classical", "jazz"]
    },
    orchestral: {
        type: "descriptor",
        featureProfile: { instrumentalness: 0.95, acousticness: 0.85 },
        related: ["classical", "cinematic", "epic"]
    },
};

// Helper to get all term names
export const VOCABULARY_TERMS = Object.keys(VOCAB_DEFINITIONS);
```

**Step 2: Verify file created**

Run: `ls -la backend/src/data/featureProfiles.ts`
Expected: File exists

**Step 3: Commit**

```bash
git add backend/src/data/featureProfiles.ts
git commit -m "feat(vibe): add research-based feature profiles for vocabulary terms"
```

---

## Task 2: Create Vocabulary Service

**Files:**
- Create: `backend/src/services/vibeVocabulary.ts`
- Create: `backend/src/data/vibe-vocabulary.json` (placeholder)

**Step 1: Create the vocabulary service**

```typescript
// backend/src/services/vibeVocabulary.ts

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger";
import { VOCAB_DEFINITIONS, FeatureProfile, TermType } from "../data/featureProfiles";

export interface VocabTerm {
    name: string;
    type: TermType;
    embedding: number[];
    featureProfile: FeatureProfile;
    related?: string[];
}

export interface Vocabulary {
    terms: Record<string, VocabTerm>;
    version: string;
    generatedAt: string;
}

export interface QueryExpansionResult {
    embedding: number[];
    genreConfidence: number;
    matchedTerms: VocabTerm[];
    originalQuery: string;
}

let vocabulary: Vocabulary | null = null;

/**
 * Load vocabulary from JSON file. Call at startup.
 */
export function loadVocabulary(): Vocabulary | null {
    const vocabPath = join(__dirname, "../data/vibe-vocabulary.json");

    if (!existsSync(vocabPath)) {
        logger.warn("[VIBE-VOCAB] Vocabulary file not found. Run generateVibeVocabulary script.");
        return null;
    }

    try {
        const data = JSON.parse(readFileSync(vocabPath, "utf-8"));
        vocabulary = data as Vocabulary;
        logger.info(`[VIBE-VOCAB] Loaded ${Object.keys(vocabulary.terms).length} vocabulary terms`);
        return vocabulary;
    } catch (error) {
        logger.error("[VIBE-VOCAB] Failed to load vocabulary:", error);
        return null;
    }
}

/**
 * Get loaded vocabulary (or attempt to load if not loaded)
 */
export function getVocabulary(): Vocabulary | null {
    if (!vocabulary) {
        return loadVocabulary();
    }
    return vocabulary;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Calculate weighted average of multiple embeddings
 */
export function blendEmbeddings(
    items: Array<{ embedding: number[]; weight: number }>
): number[] {
    if (items.length === 0) return [];

    const dim = items[0].embedding.length;
    const result = new Array(dim).fill(0);
    let totalWeight = 0;

    for (const { embedding, weight } of items) {
        for (let i = 0; i < dim; i++) {
            result[i] += embedding[i] * weight;
        }
        totalWeight += weight;
    }

    if (totalWeight > 0) {
        for (let i = 0; i < dim; i++) {
            result[i] /= totalWeight;
        }
    }

    return result;
}

/**
 * Find vocabulary terms similar to a query embedding
 */
export function findSimilarTerms(
    queryEmbedding: number[],
    vocab: Vocabulary,
    minSimilarity: number = 0.55,
    maxTerms: number = 5
): Array<{ term: VocabTerm; similarity: number }> {
    const matches: Array<{ term: VocabTerm; similarity: number }> = [];

    for (const [name, term] of Object.entries(vocab.terms)) {
        const similarity = cosineSimilarity(queryEmbedding, term.embedding);
        if (similarity >= minSimilarity) {
            matches.push({ term, similarity });
        }
    }

    return matches
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxTerms);
}

/**
 * Expand a query using vocabulary term matching
 */
export function expandQueryWithVocabulary(
    queryEmbedding: number[],
    originalQuery: string,
    vocab: Vocabulary
): QueryExpansionResult {
    // Find similar vocabulary terms
    const matches = findSimilarTerms(queryEmbedding, vocab, 0.55, 5);

    if (matches.length === 0) {
        // No matches - return original embedding
        return {
            embedding: queryEmbedding,
            genreConfidence: 0,
            matchedTerms: [],
            originalQuery
        };
    }

    // Calculate genre confidence (highest similarity to a genre term)
    const genreMatches = matches.filter(m => m.term.type === "genre");
    const genreConfidence = genreMatches.length > 0 ? genreMatches[0].similarity : 0;

    // Blend embeddings: 60% original query, 40% distributed among matches
    const embeddingItems: Array<{ embedding: number[]; weight: number }> = [
        { embedding: queryEmbedding, weight: 0.6 }
    ];

    const matchWeight = 0.4 / matches.length;
    for (const match of matches) {
        embeddingItems.push({
            embedding: match.term.embedding,
            weight: matchWeight * match.similarity
        });
    }

    const blendedEmbedding = blendEmbeddings(embeddingItems);

    return {
        embedding: blendedEmbedding,
        genreConfidence,
        matchedTerms: matches.map(m => m.term),
        originalQuery
    };
}

/**
 * Blend multiple feature profiles into a target profile
 */
export function blendFeatureProfiles(terms: VocabTerm[]): FeatureProfile {
    if (terms.length === 0) return {};

    const features = ["energy", "valence", "danceability", "acousticness",
                      "instrumentalness", "arousal", "speechiness"] as const;

    const result: FeatureProfile = {};

    for (const feature of features) {
        const values = terms
            .map(t => t.featureProfile[feature])
            .filter((v): v is number => v !== undefined);

        if (values.length > 0) {
            result[feature] = values.reduce((a, b) => a + b, 0) / values.length;
        }
    }

    return result;
}

/**
 * Calculate how well a track's features match a target profile
 */
export function calculateFeatureMatch(
    trackFeatures: Record<string, number | null>,
    targetProfile: FeatureProfile
): number {
    let score = 0;
    let count = 0;

    for (const [feature, targetValue] of Object.entries(targetProfile)) {
        if (targetValue === undefined) continue;

        const trackValue = trackFeatures[feature] ?? 0.5;
        const match = 1 - Math.abs(trackValue - targetValue);
        score += match;
        count++;
    }

    return count > 0 ? score / count : 0.5;
}

/**
 * Re-rank CLAP candidates using audio features
 */
export function rerankWithFeatures<T extends {
    id: string;
    distance: number;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    acousticness?: number | null;
    instrumentalness?: number | null;
    arousal?: number | null;
    speechiness?: number | null;
}>(
    candidates: T[],
    matchedTerms: VocabTerm[],
    genreConfidence: number
): Array<T & { finalScore: number; clapScore: number; featureScore: number }> {
    // Build composite feature profile from matched terms
    const targetProfile = blendFeatureProfiles(matchedTerms);

    // Calculate dynamic weights based on genre confidence
    // High confidence (0.8+) → 40% CLAP, 60% features
    // Low confidence (0.3)  → 80% CLAP, 20% features
    const featureWeight = 0.2 + (genreConfidence * 0.5);
    const clapWeight = 1 - featureWeight;

    logger.debug(`[VIBE-RERANK] Genre confidence: ${(genreConfidence * 100).toFixed(0)}%, ` +
                 `Weights: CLAP ${(clapWeight * 100).toFixed(0)}% / Features ${(featureWeight * 100).toFixed(0)}%`);

    return candidates.map(track => {
        // CLAP score: convert distance to 0-1 similarity
        const clapScore = Math.max(0, 1 - (track.distance / 2));

        // Feature score
        const trackFeatures: Record<string, number | null> = {
            energy: track.energy,
            valence: track.valence,
            danceability: track.danceability,
            acousticness: track.acousticness,
            instrumentalness: track.instrumentalness,
            arousal: track.arousal,
            speechiness: track.speechiness
        };

        const featureScore = Object.keys(targetProfile).length > 0
            ? calculateFeatureMatch(trackFeatures, targetProfile)
            : 0.5;

        // Blend scores
        const finalScore = (clapWeight * clapScore) + (featureWeight * featureScore);

        return {
            ...track,
            finalScore,
            clapScore,
            featureScore
        };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}
```

**Step 2: Create placeholder vocabulary JSON**

```json
{
  "version": "0.0.0",
  "generatedAt": "placeholder",
  "terms": {}
}
```

Save to: `backend/src/data/vibe-vocabulary.json`

**Step 3: Verify files created**

Run: `ls -la backend/src/services/vibeVocabulary.ts backend/src/data/vibe-vocabulary.json`
Expected: Both files exist

**Step 4: Type check**

Run: `cd backend && npm run build 2>&1 | tail -5`
Expected: No errors

**Step 5: Commit**

```bash
git add backend/src/services/vibeVocabulary.ts backend/src/data/vibe-vocabulary.json
git commit -m "feat(vibe): add vocabulary service for query expansion and re-ranking"
```

---

## Task 3: Create Vocabulary Generation Script

**Files:**
- Create: `backend/scripts/generateVibeVocabulary.ts`

**Step 1: Create the generation script**

```typescript
// backend/scripts/generateVibeVocabulary.ts

import { createClient } from "redis";
import { randomUUID } from "crypto";
import { writeFileSync } from "fs";
import { join } from "path";
import { VOCAB_DEFINITIONS, VOCABULARY_TERMS } from "../src/data/featureProfiles";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

interface VocabTerm {
    name: string;
    type: string;
    embedding: number[];
    featureProfile: Record<string, number>;
    related?: string[];
}

async function getClapTextEmbedding(
    redisClient: ReturnType<typeof createClient>,
    text: string
): Promise<number[]> {
    const requestId = randomUUID();
    const responseChannel = `audio:text:embed:response:${requestId}`;
    const requestChannel = "audio:text:embed";

    const subscriber = redisClient.duplicate();
    await subscriber.connect();

    try {
        return await new Promise<number[]>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout getting embedding for: ${text}`));
            }, 30000);

            subscriber.subscribe(responseChannel, (message) => {
                clearTimeout(timeout);
                try {
                    const data = JSON.parse(message);
                    if (data.error) {
                        reject(new Error(data.error));
                    } else {
                        resolve(data.embedding);
                    }
                } catch (e) {
                    reject(new Error("Invalid response"));
                }
            });

            redisClient.publish(
                requestChannel,
                JSON.stringify({ requestId, text })
            );
        });
    } finally {
        await subscriber.unsubscribe(responseChannel);
        await subscriber.disconnect();
    }
}

async function main() {
    console.log("Connecting to Redis...");
    const redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();

    console.log(`Generating embeddings for ${VOCABULARY_TERMS.length} terms...`);

    const terms: Record<string, VocabTerm> = {};
    let success = 0;
    let failed = 0;

    for (const termName of VOCABULARY_TERMS) {
        const definition = VOCAB_DEFINITIONS[termName];

        try {
            process.stdout.write(`  ${termName}... `);
            const embedding = await getClapTextEmbedding(redisClient, termName);

            terms[termName] = {
                name: termName,
                type: definition.type,
                embedding,
                featureProfile: definition.featureProfile,
                related: definition.related
            };

            console.log(`OK (${embedding.length} dims)`);
            success++;
        } catch (error) {
            console.log(`FAILED: ${error}`);
            failed++;
        }

        // Small delay to not overwhelm the CLAP service
        await new Promise(r => setTimeout(r, 100));
    }

    const vocabulary = {
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        terms
    };

    const outputPath = join(__dirname, "../src/data/vibe-vocabulary.json");
    writeFileSync(outputPath, JSON.stringify(vocabulary, null, 2));

    console.log(`\nDone! ${success} terms generated, ${failed} failed.`);
    console.log(`Vocabulary saved to: ${outputPath}`);

    await redisClient.disconnect();
}

main().catch(console.error);
```

**Step 2: Add script to package.json**

In `backend/package.json`, add to scripts:

```json
"generate:vocabulary": "ts-node scripts/generateVibeVocabulary.ts"
```

**Step 3: Type check**

Run: `cd backend && npx tsc --noEmit scripts/generateVibeVocabulary.ts 2>&1 | head -10`
Expected: No errors (or minor config issues that don't block execution)

**Step 4: Commit**

```bash
git add backend/scripts/generateVibeVocabulary.ts backend/package.json
git commit -m "feat(vibe): add vocabulary generation script"
```

---

## Task 4: Integrate Enhanced Search into Vibe Route

**Files:**
- Modify: `backend/src/routes/vibe.ts`

**Step 1: Update vibe.ts imports**

Add at top of file:

```typescript
import {
    getVocabulary,
    expandQueryWithVocabulary,
    rerankWithFeatures,
    loadVocabulary
} from "../services/vibeVocabulary";

// Load vocabulary at module initialization
loadVocabulary();
```

**Step 2: Update TextSearchResult interface to include audio features**

```typescript
interface TextSearchResult {
    id: string;
    title: string;
    duration: number;
    trackNo: number;
    distance: number;
    albumId: string;
    albumTitle: string;
    albumCoverUrl: string | null;
    artistId: string;
    artistName: string;
    // Audio features for re-ranking
    energy: number | null;
    valence: number | null;
    danceability: number | null;
    acousticness: number | null;
    instrumentalness: number | null;
    arousal: number | null;
    speechiness: number | null;
}
```

**Step 3: Update the search SQL query to include audio features**

Replace the SQL query in POST /search with:

```typescript
            const similarTracks = await prisma.$queryRaw<TextSearchResult[]>`
                SELECT
                    t.id,
                    t.title,
                    t.duration,
                    t."trackNo",
                    te.embedding <=> ${searchEmbedding}::vector AS distance,
                    a.id as "albumId",
                    a.title as "albumTitle",
                    a."coverUrl" as "albumCoverUrl",
                    ar.id as "artistId",
                    ar.name as "artistName",
                    t.energy,
                    t.valence,
                    t.danceability,
                    t.acousticness,
                    t.instrumentalness,
                    t.arousal,
                    t.speechiness
                FROM track_embeddings te
                JOIN "Track" t ON te.track_id = t.id
                JOIN "Album" a ON t."albumId" = a.id
                JOIN "Artist" ar ON a."artistId" = ar.id
                WHERE te.embedding <=> ${searchEmbedding}::vector <= ${maxDistance}
                ORDER BY te.embedding <=> ${searchEmbedding}::vector
                LIMIT ${limit * 3}
            `;
```

Note: `limit * 3` to fetch more candidates for re-ranking.

**Step 4: Add query expansion and re-ranking logic**

After getting `textEmbedding` and before the SQL query, add:

```typescript
            // Query expansion with vocabulary
            const vocab = getVocabulary();
            let searchEmbedding = textEmbedding;
            let genreConfidence = 0;
            let matchedTerms: any[] = [];

            if (vocab) {
                const expansion = expandQueryWithVocabulary(textEmbedding, query.trim(), vocab);
                searchEmbedding = expansion.embedding;
                genreConfidence = expansion.genreConfidence;
                matchedTerms = expansion.matchedTerms;

                logger.info(`[VIBE-SEARCH] Query "${query.trim()}" expanded with terms: ${matchedTerms.map(t => t.name).join(", ") || "none"}, genre confidence: ${(genreConfidence * 100).toFixed(0)}%`);
            }
```

**Step 5: Add re-ranking after fetching candidates**

After the SQL query, before building the response, add:

```typescript
            // Re-rank using audio features if we have vocabulary matches
            let rankedTracks = similarTracks;
            if (vocab && matchedTerms.length > 0) {
                const reranked = rerankWithFeatures(similarTracks, matchedTerms, genreConfidence);
                rankedTracks = reranked.slice(0, limit);

                logger.info(`[VIBE-SEARCH] Re-ranked ${similarTracks.length} candidates, top result: ${rankedTracks[0]?.title || "none"}`);
            } else {
                rankedTracks = similarTracks.slice(0, limit);
            }
```

**Step 6: Update response to use rankedTracks**

```typescript
            const tracks = rankedTracks.map((row) => ({
                id: row.id,
                title: row.title,
                duration: row.duration,
                trackNo: row.trackNo,
                distance: row.distance,
                similarity: "finalScore" in row ? (row as any).finalScore : distanceToSimilarity(row.distance),
                album: {
                    id: row.albumId,
                    title: row.albumTitle,
                    coverUrl: row.albumCoverUrl,
                },
                artist: {
                    id: row.artistId,
                    name: row.artistName,
                },
            }));

            res.json({
                query: query.trim(),
                tracks,
                minSimilarity: similarityThreshold,
                totalAboveThreshold: tracks.length,
                debug: {
                    matchedTerms: matchedTerms.map(t => t.name),
                    genreConfidence,
                    featureWeight: matchedTerms.length > 0 ? 0.2 + (genreConfidence * 0.5) : 0
                }
            });
```

**Step 7: Type check**

Run: `cd backend && npm run build 2>&1 | tail -10`
Expected: No errors

**Step 8: Commit**

```bash
git add backend/src/routes/vibe.ts
git commit -m "feat(vibe): integrate vocabulary expansion and feature re-ranking into search"
```

---

## Task 5: Generate Vocabulary and Test

**Step 1: Ensure CLAP analyzer is running**

Run: `docker compose ps audio-analyzer-clap`
Expected: Shows "running" or "Up"

If not running:
Run: `docker compose up -d audio-analyzer-clap`

**Step 2: Generate vocabulary**

Run: `cd backend && npm run generate:vocabulary`
Expected: Output showing each term being processed, ending with success message

**Step 3: Verify vocabulary file**

Run: `head -50 backend/src/data/vibe-vocabulary.json`
Expected: JSON with terms containing embeddings (512-dimensional arrays)

**Step 4: Rebuild and restart backend**

Run: `cd /run/media/chevron7/Storage/Projects/lidify && docker compose restart backend`
Expected: Container restarts

**Step 5: Test search in browser**

- Navigate to /vibe page
- Search "electronic"
- Verify results show more electronic-sounding tracks than before
- Check browser network tab for debug info in response

**Step 6: Commit vocabulary**

```bash
git add backend/src/data/vibe-vocabulary.json
git commit -m "feat(vibe): generate vocabulary embeddings"
```

---

## Task 6: Update Frontend Types

**Files:**
- Modify: `frontend/lib/api.ts`

**Step 1: Update vibeSearch return type**

```typescript
    async vibeSearch(query: string, limit = 20) {
        return this.request<{
            query: string;
            tracks: Array<{
                id: string;
                title: string;
                duration: number;
                trackNo: number;
                distance: number;
                similarity: number;
                album: {
                    id: string;
                    title: string;
                    coverUrl: string | null;
                };
                artist: {
                    id: string;
                    name: string;
                };
            }>;
            minSimilarity: number;
            totalAboveThreshold: number;
            debug?: {
                matchedTerms: string[];
                genreConfidence: number;
                featureWeight: number;
            };
        }>("/vibe/search", {
            method: "POST",
            body: JSON.stringify({ query, limit }),
        });
    }
```

**Step 2: Type check frontend**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(vibe): update frontend types for enhanced search response"
```

---

## Summary

After completing all tasks:

1. **Feature profiles** define target audio characteristics for 70+ terms
2. **Vocabulary service** handles query expansion and re-ranking
3. **Generation script** creates CLAP embeddings for all terms
4. **Vibe route** integrates the new pipeline
5. **Frontend types** updated for debug info

The enhanced search will:
- Expand "electronic" to include related terms, boosting accuracy
- Re-rank results using audio features when genre intent is detected
- Fall back to CLAP-only when vocabulary isn't available
- Provide debug info for tuning
