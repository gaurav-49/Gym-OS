package com.gymos.common.util;

/**
 * Title Case for the things people type: names and addresses.
 *
 * <p>The desk types however it types — {@code GAURAV SHARMA} on one shift,
 * {@code gaurav sharma} on the next — and the same member then appears twice
 * over in a list sorted by name, reads as shouting on a receipt, and looks like
 * two different records to anyone scanning the page. So the value is settled
 * once, on the way in, and every screen shows it the same way.
 *
 * <p>Two things are deliberately left alone:
 *
 * <ul>
 *   <li><b>Anything with a digit in it</b> — {@code 12A}, {@code L-101},
 *       {@code 3rd}. These are identifiers and house numbers, not words, and
 *       lower-casing them makes them wrong.</li>
 *   <li><b>Short all-capital words</b> — {@code MG Road}, {@code DLF},
 *       {@code IIT}. Four letters or fewer, typed in capitals, is an acronym
 *       far more often than it is shouting.</li>
 * </ul>
 *
 * <p>Word boundaries include hyphens and apostrophes, so {@code jean-luc}
 * becomes {@code Jean-Luc} and {@code d'souza} becomes {@code D'Souza}.
 */
public final class Names {

    /** Longer than this, an all-capitals word is shouting rather than an acronym. */
    private static final int ACRONYM_MAX = 4;

    private Names() {
    }

    /**
     * @param value what was typed; null and blank come back unchanged
     * @return the same text in Title Case, with runs of whitespace collapsed
     */
    public static String titleCase(String value) {
        if (value == null) return null;
        String trimmed = value.trim().replaceAll("\\s+", " ");
        if (trimmed.isEmpty()) return trimmed;

        StringBuilder out = new StringBuilder(trimmed.length());
        for (String word : trimmed.split(" ")) {
            if (out.length() > 0) out.append(' ');
            out.append(word(word));
        }
        return out.toString();
    }

    private static String word(String word) {
        if (word.isEmpty()) return word;
        // A house number, a locker number, a floor: not a word, leave it be.
        if (word.chars().anyMatch(Character::isDigit)) return word;
        // MG, DLF, IIT — short and already capitalised, so meant that way.
        if (word.length() <= ACRONYM_MAX && word.equals(word.toUpperCase())
            && word.chars().anyMatch(Character::isLetter)) {
            return word;
        }

        StringBuilder out = new StringBuilder(word.length());
        boolean startOfWord = true;
        for (char c : word.toCharArray()) {
            if (startOfWord) {
                out.append(Character.toUpperCase(c));
            } else {
                out.append(Character.toLowerCase(c));
            }
            // A hyphen or an apostrophe starts a new word inside the same token.
            startOfWord = c == '-' || c == '\'' || c == '.';
        }
        return out.toString();
    }
}
