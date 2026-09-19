package com.gymos.common.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class NamesTest {

    @Test
    void capitalisesEachWord() {
        assertEquals("Gaurav Sharma", Names.titleCase("gaurav sharma"));
        assertEquals("Gaurav Sharma", Names.titleCase("GAURAV SHARMA"));
        assertEquals("Gaurav Sharma", Names.titleCase("gAuRaV sHaRmA"));
    }

    @Test
    void collapsesWhitespaceAndTrims() {
        assertEquals("Neha Nayar", Names.titleCase("  neha    nayar  "));
    }

    @Test
    void keepsAnythingWithADigitExactlyAsTyped() {
        // House numbers and locker numbers are identifiers, not words.
        assertEquals("12A, Station Road", Names.titleCase("12A, station road"));
        assertEquals("L-101", Names.titleCase("L-101"));
        assertEquals("3rd Floor", Names.titleCase("3rd FLOOR"));
    }

    @Test
    void keepsShortAcronyms() {
        assertEquals("MG Road, Jehanabad", Names.titleCase("MG road, JEHANABAD"));
        assertEquals("DLF Phase", Names.titleCase("DLF phase"));
    }

    @Test
    void capitalisesAfterHyphensAndApostrophes() {
        assertEquals("Jean-Luc", Names.titleCase("jean-luc"));
        assertEquals("D'Souza", Names.titleCase("d'souza"));
        assertEquals("O'Brien", Names.titleCase("O'BRIEN"));
    }

    @Test
    void leavesNullAndBlankAlone() {
        assertNull(Names.titleCase(null));
        assertEquals("", Names.titleCase("   "));
    }
}
