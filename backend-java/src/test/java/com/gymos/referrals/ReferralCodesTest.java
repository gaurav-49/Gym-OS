package com.gymos.referrals;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ReferralCodesTest {

    @Test
    void firstFourLettersOfTheNameThenTheMemberIdPaddedToFour() {
        assertEquals("GAUR0001", ReferralCodes.forMember("Gaurav", "1"));
        assertEquals("AARA0744", ReferralCodes.forMember("Aarav Patil", "744"));
        assertEquals("SHIV0743", ReferralCodes.forMember("Shivani Ghosh", "743"));
    }

    @Test
    void shortNamesArePaddedSoEveryCodeIsTheSameShape() {
        // Read aloud at a desk, so a fixed eight characters beats a ragged one.
        assertEquals("OMXX0009", ReferralCodes.forMember("Om", "9"));
        assertEquals("XXXX0009", ReferralCodes.forMember("", "9"));
        assertEquals("XXXX0009", ReferralCodes.forMember(null, "9"));
    }

    @Test
    void punctuationAndSpacingAreDroppedNotCounted() {
        // "O'Brien" must not become "O'BR" — the code has to be typeable.
        assertEquals("OBRI0012", ReferralCodes.forMember("O'Brien", "12"));
        assertEquals("SKRA0012", ReferralCodes.forMember("S K Rao", "12"));
    }

    @Test
    void aLongMemberIdIsKeptWholeRatherThanTruncated() {
        // Cutting it to four digits would point the code at a different member.
        assertEquals("RAVI12345", ReferralCodes.forMember("Ravi", "12345"));
    }

    @Test
    void nonDigitsInTheMemberIdAreStripped() {
        assertEquals("RAVI0044", ReferralCodes.forMember("Ravi", "M-44"));
    }
}
