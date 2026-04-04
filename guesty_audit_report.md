# Destination Guesty Account — Audit Report
**Date:** April 4, 2026  
**Migration ID:** 2014a96a-386b-46fb-b49c-2d09d843f4c2

---

## Executive Summary

The destination Guesty account contains **137 listings** across **36 multi-unit (MTL) parent complexes** and **31 standalone single listings**, totalling **70 MTL sub-unit children**. The audit covers structural integrity, data completeness, listing status, and geographic distribution.

**Summary scorecard:**

| Area | Status | Detail |
|------|--------|--------|
| MTL parent–child integrity | ✅ Clean | All 70 children have valid parent references |
| Photo coverage | ✅ Clean | 0 listings without photos |
| Description completeness | ✅ Clean | 0 listings without public description |
| Address & coordinates | ✅ Clean | All listings have full address + lat/lng |
| Base pricing | ✅ Clean | All listings have a base price |
| Tags | ✅ Clean | All listings have tags |
| Listing status (isListed) | ⚠️ Attention | 11 of 137 listings are live on channels |
| Empty MTL parent complexes | ⚠️ Attention | 4 parent complexes have no sub-units |
| Missing bathroom data | ⚠️ Attention | 3 listings have null bathroom value |
| Zero bathroom on sub-units | ⚠️ Attention | 69 of 70 child listings show 0 bathrooms |
| CWOR under ELY parent | ℹ️ Review | 13 CWOR listings grouped under ELY — verify with client |
| WYN-W-CAL-OPE anomaly | ℹ️ Review | 3 listings share the same base nickname |
| KEK 2BR gap | ℹ️ Review | Unit 2BR29 absent from KEK 2-bedroom complex |

---

## 1. Inventory Overview

| Category | Count |
|----------|-------|
| Total listings | **137** |
| MTL parent complexes | **36** |
| MTL child sub-unit listings | **70** |
| Single / standalone listings | **31** |
| Listings marked isListed = true | **11** |
| Listings marked isListed = false | **126** |
| Primary property type | Condominium (134 of 137) |
| Countries | United States (136), U.S. Virgin Islands (1) |

---

## 2. Geographic Distribution

| State / Region            | Count |
|---------------------------|-------|
| Hawaii                    | 43    |
| Texas                     | 21    |
| South Carolina            | 19    |
| Colorado                  | 15    |
| California                | 12    |
| Georgia                   | 8     |
| Virginia                  | 4     |
| Vermont                   | 4     |
| Florida                   | 4     |
| New Jersey                | 2     |
| Tennessee                 | 2     |
| Missouri                  | 1     |
| Oklahoma                  | 1     |
| St. Thomas                | 1     |

Hawaii has the largest concentration of listings (43), followed by Texas (21) and South Carolina (19).

---

## 3. MTL Complex Structure

All 36 MTL parent complexes and their sub-unit counts. Complexes marked with * have no sub-units.

| Complex (Parent)                      | Sub-units | Location                       | Beds  | Baths  | Sleeps |
|---------------------------------------|-----------|--------------------------------|-------|--------|--------|
| MAR-CA-SR-MD-10BRMU *                 | 0         | Palm Desert, California        | 10    | 10     | 8      |
| MAR-CO-SSR-1BRMU                      | 1         | Steamboat Springs, Colorado    | 1     | 1      | 4      |
| MAR-CO-SSR-2BRMU                      | 1         | Steamboat Springs, Colorado    | 2     | 2      | 6      |
| MAR-CO-SSR-3BRMU                      | 1         | Steamboat Springs, Colorado    | 3     | 3      | 8      |
| MAR-CO-SSR-4BRMU                      | 1         | Steamboat Springs, Colorado    | 4     | 4      | 12     |
| MAR-CO-SSR-HOTMU                      | 1         | Steamboat Springs, Colorado    | 0     | 1      | 2      |
| MAR-CO-SSR-STUMU                      | 1         | Steamboat Springs, Colorado    | 0     | 1      | 4      |
| MAR-HI-SKRV-STUMU                     | 1         | Koloa, Hawaii                  | 0     | 1      | 2      |
| MAR-HI-WKORV-1BRMU                    | 1         | Lahaina, Hawaii                | 1     | 1      | 4      |
| MAR-HI-WKORV-2BRMU                    | 1         | Lahaina, Hawaii                | 2     | 2      | 8      |
| MAR-HI-WKORV-STMU                     | 1         | Lahaina, Hawaii                | 0     | 1      | 4      |
| MAR-HI-WPOR-1BRMU                     | 1         | Princeville, Hawaii            | 1     | 1      | 4      |
| MAR-HI-WPOR-2BRMU                     | 1         | Princeville, Hawaii            | 2     | 0      | 8      |
| WYN-C-MW-CWGL-2BRMU *                 | 0         | Afton, Oklahoma                | 2     | 2      | 6      |
| WYN-C-MW-MEAD-2BRMU *                 | 0         | Branson, Missouri              | 2     | 2      | 8      |
| WYN-C-TEX-LC-3BRMU                    | 1         | San Antonio, Texas             | 3     | 3      | 8      |
| WYN-C-TEX-LC-4BRMU                    | 1         | San Antonio, Texas             | 4     | 4      | 10     |
| WYN-C-W-SS-3BRMU                      | 1         | Steamboat Springs, Colorado    | 3     | 2      | 8      |
| WYN-E-EC-CWOTA-1BRMU                  | 1         | Alexandria, Virginia           | 1     | 1      | 4      |
| WYN-E-EC-CWSKY-3BRMU                  | 1         | Atlantic City, New Jersey      | 3     | 2      | 8      |
| WYN-E-NE-CWSNH-1BRMU                  | 1         | Cambridge, Vermont             | 1     | 1      | 6      |
| WYN-E-NE-CWSNH-2BRMU                  | 1         | Cambridge, Vermont             | 2     | 2      | 8      |
| WYN-E-T-MARG-STUMU                    | 1         | Nashville, Tennessee           | 0     | 1      | 4      |
| WYN-SE-C-CWCP-2BRMU                   | 1         | Kissimmee, Florida             | 2     | 2      | 8      |
| WYN-SE-C-CWSI-3BRMU                   | 1         | Kissimmee, Florida             | 3     | 2      | 10     |
| WYN-SE-CAR-ELY-STUMU                  | 13        | St. Thomas                     | 0     | 1      | 2      |
| WYN-SE-G-MARG-1BRMU                   | 1         | Atlanta, Georgia               | 1     | 1      | 4      |
| WYN-SE-G-MARG-2BRMU                   | 1         | Atlanta, Georgia               | 2     | 2      | 8      |
| WYN-SE-G-MARG-3BRMU                   | 1         | Atlanta, Georgia               | 3     | 2.5    | 12     |
| WYN-SE-G-MARG-STUMU                   | 1         | Atlanta, Georgia               | 0     | 1      | 4      |
| WYN-SE-SC-CWLM-2BRMU                  | 1         | Santee, South Carolina         | 2     | 2      | 6      |
| WYN-SE-SC-CWLM-3BRMU                  | 1         | Santee, South Carolina         | 3     | 3      | 10     |
| WYN-SE-SC-CWWW-1BRMU                  | 1         | North Myrtle Beach, South Carolina | 1     | 1      | 4      |
| WYN-W-CAL-OPE-1BRMU *                 | 0         | San Francisco, California      | 0     | —      | 2      |
| WYN-W-HI-KEK-2BRMU                    | 3         | Princeville, Hawaii            | 2     | 2      | 6      |
| WYN-W-HI-KEK-STUMU                    | 25        | Princeville, Hawaii            | 0     | 1      | 2      |

### 3a. Empty Parent Complexes (4)

The following 4 parent listings have no child sub-unit listings attached:

| Complex | Location | Specs | Note |
|---------|----------|-------|------|
| MAR-CA-SR-MD-10BRMU | Palm Desert, CA | 10BR / 10BA / sleeps 8 | Parent exists; 8 standalone SINGLE listings (LS-CA-SR-MD-10BR01–08) are live but not linked as MTL children |
| WYN-C-MW-CWGL-2BRMU | Afton, OK (Grand Lake) | 2BR / 2BA / sleeps 6 | No channel listing attached |
| WYN-C-MW-MEAD-2BRMU | Branson, MO | 2BR / 2BA / sleeps 8 | No channel listing attached |
| WYN-W-CAL-OPE-1BRMU | San Francisco, CA | 0BR / no bathrooms | See Anomaly A below |

**Recommendation:** Confirm with the client whether sub-unit (CAL) listings should be created for these complexes, or if the parent records should be removed.

### 3b. WYN-SE-CAR-ELY-STUMU — Sub-Units (13)

The ELY parent (Wyndham Elysian, South Carolina) carries 13 child listings. Twelve have CWOR (Ocean Ridge) nicknames and one is LS-OCEANRIDGE-1BR05. During the fix process these were re-parented here as no dedicated CWOR parent complex existed in the destination.

- LS-OCEANRIDGE-1BR05 (bathrooms: 0)
- LS-SE-SC-CWOR-1BR01 (bathrooms: 1)
- LS-SE-SC-CWOR-1BR03 (bathrooms: 0)
- LS-SE-SC-CWOR-1BR04 (bathrooms: 0)
- LS-SE-SC-CWOR-1BR05 (bathrooms: 0)
- LS-SE-SC-CWOR-1BR07 (bathrooms: 0)
- LS-SE-SC-CWOR-1BR08 (bathrooms: 0)
- LS-SE-SC-CWOR-1BR09 (bathrooms: 0)
- LS-SE-SC-CWOR-1BR10 (bathrooms: 0)
- LSE-SE-SC-CWOR-1BR02 (bathrooms: 0)
- LSE-SE-SC-CWOR-1BR04 (bathrooms: 0)
- SL-SE-SC-CWOR-1BR12 (bathrooms: 0)
- SL-SE-SC-CWOR-1BR14 (bathrooms: 0)

**Note:** 12 of 13 sub-units report bathrooms = 0. This appears to be a source-side data gap.

**Recommendation:** Confirm with client whether CWOR / Ocean Ridge is a distinct property from ELY. If so, a dedicated CWOR parent complex should be created and these 13 listings re-parented.

### 3c. WYN-W-HI-KEK-STUMU — Studio Sub-Units (25)

All 25 Kekaha Studio sub-units (LW-W-HI-KEK-STU01 through STU25) are correctly linked to the KEK Studio parent. Each has 44 photos, 1 bedroom, and accommodates 2. All show **bathrooms = 0** — client should confirm if this is accurate for these studio units.

### 3d. WYN-W-HI-KEK-2BRMU — 2-Bedroom Sub-Units (3)

The KEK 2-bedroom complex has 3 child listings: 2BR27, 2BR28, 2BR30. **Unit 2BR29 is absent.** Client should confirm if this unit was intentionally excluded from the migration.

---

## 4. Listing Status

Only **11 of 137** listings have isListed = true and are live on booking channels:

| Listing(s) | Type | Location | Count |
|------------|------|----------|-------|
| LS-CA-SR-MD-10BR01 through 10BR08 | SINGLE | Palm Desert, CA | 8 |
| WYN-W-CAL-OPE-1BRMU (1) & (2) | SINGLE | San Francisco, CA | 2 |
| WYN-SE-CAR-ELY-STUMU | MTL parent | South Carolina | 1 |

**126 listings are not published to any channel.** This is typical immediately after a data migration — channels are usually connected manually post-migration. No corrective action is needed unless the client expects these to be live.

---

## 5. Data Completeness

| Check | Result | Count |
|-------|--------|-------|
| Listings with no photos | ✅ Pass | 0 |
| Listings with fewer than 3 photos | ✅ Pass | 0 |
| Listings with no public description | ✅ Pass | 0 |
| Listings with no address | ✅ Pass | 0 |
| Listings with no coordinates | ✅ Pass | 0 |
| Listings with no base price | ✅ Pass | 0 |
| Listings with no accommodates count | ✅ Pass | 0 |
| Listings with no bedroom count | ✅ Pass | 0 |
| Listings with null bathroom value | ⚠️ Fail | 3 |
| MTL children with bathrooms = 0 | ⚠️ Attention | 69 of 70 |
| MTL children with invalid parent reference | ✅ Pass | 0 |
| Listings with no tags | ✅ Pass | 0 |

### 5a. Null Bathroom Data

3 listings have a null/undefined bathroom value — all in the WYN-W-CAL-OPE cluster (San Francisco, CA). These also have bedrooms = 0.

### 5b. Zero Bathroom on Sub-Units

69 of 70 MTL child listings report bathrooms = 0. Affected groups:
- All 25 LW-W-HI-KEK-STU* (Kekaha Studios)
- 12 of 13 LS-SE-SC-CWOR / LS-OCEANRIDGE sub-units

The remaining child listings (MAR-*, WYN-E-*, WYN-SE-G-MARG-*, etc.) show correct non-zero bathroom values. The zeros appear to be source-side data and should be reviewed with the client.

---

## 6. Anomalies Requiring Client Review

### Anomaly A — WYN-W-CAL-OPE Nickname Duplication

3 listings share the same base nickname "WYN-W-CAL-OPE-1BRMU" in San Francisco, CA:

| Nickname | Type | Listing ID | isListed |
|----------|------|-----------|----------|
| WYN-W-CAL-OPE-1BRMU (1) | SINGLE | 69cc5f219d360e00151410c9 | Yes (live) |
| WYN-W-CAL-OPE-1BRMU | MTL | 69cc5f2309893600140e7b77 | No |
| WYN-W-CAL-OPE-1BRMU (2) | SINGLE | 69cc5f223ec87d000f835e11 | Yes (live) |

All three have 0 bedrooms and null bathrooms. The MTL parent has no sub-units.

**Recommendation:** Clarify with client the intended structure for this property. Likely one of: (a) 2 standalone units that should remain SINGLEs, with the MTL parent removed; or (b) a proper MTL complex where the two SINGLEs should become children of the MTL parent. Bedroom and bathroom data should also be corrected.

### Anomaly B — KEK 2-Bedroom Unit 29 Missing

The KEK 2BR complex (WYN-W-HI-KEK-2BRMU, Kekaha, Hawaii) has sub-units 2BR27, 2BR28, and 2BR30. Unit **2BR29 is absent**.

**Recommendation:** Confirm with client whether unit 29 exists in the source account. If it does, it should be added; if the unit does not exist or was not included in the migration intentionally, no action is needed.

### Anomaly C — CWOR Sub-Units Under ELY Parent

13 Ocean Ridge (CWOR) and Ocean Ridge adjacent listings are grouped under the WYN-SE-CAR-ELY-STUMU parent because no dedicated CWOR parent complex was present in the destination account. If CWOR and ELY are separate properties, a new CWOR MTL parent would need to be created and these 13 listings re-parented.

---

## 7. Single Listings

All 31 standalone listings:

| Listing                               | Location                       | Beds  | Listed  |
|---------------------------------------|--------------------------------|-------|---------|
| DB-AUSTIN-1BR05                       | Austin, Texas                  | 1     | No      |
| DB-AUSTIN-1BR06                       | Austin, Texas                  | 1     | No      |
| DB-AUSTIN-1BR07                       | Austin, Texas                  | 1     | No      |
| DB-AUSTIN-1BR08                       | Austin, Texas                  | 1     | No      |
| DB-AUSTIN-1BR09                       | Austin, Texas                  | 1     | No      |
| DB-AUSTIN-1BR10                       | Austin, Texas                  | 1     | No      |
| JM-PATRTPLACE-1BR01                   | Williamsburg, Virginia         | 1     | No      |
| JM-PATRTPLACE-1BR03                   | Williamsburg, Virginia         | 1     | No      |
| LS-CA-SR-MD-10BR01                    | Palm Desert, California        | 10    | Yes     |
| LS-CA-SR-MD-10BR02                    | Palm Desert, California        | 10    | Yes     |
| LS-CA-SR-MD-10BR03                    | Palm Desert, California        | 10    | Yes     |
| LS-CA-SR-MD-10BR04                    | Palm Desert, California        | 10    | Yes     |
| LS-CA-SR-MD-10BR05                    | Palm Desert, California        | 10    | Yes     |
| LS-CA-SR-MD-10BR06                    | Palm Desert, California        | 10    | Yes     |
| LS-CA-SR-MD-10BR07                    | Palm Desert, California        | 10    | Yes     |
| LS-CA-SR-MD-10BR08                    | Palm Desert, California        | 10    | Yes     |
| P-AUSTIN-1BR01                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR02                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR03                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR04                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR05                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR06                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR07                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR08                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR09                        | Austin, Texas                  | 1     | No      |
| P-AUSTIN-1BR10                        | Austin, Texas                  | 1     | No      |
| RA-AUSTIN-1BR01                       | Austin, Texas                  | 1     | No      |
| RA-AVON-1BR02                         | Avon, Colorado                 | 1     | No      |
| RA-KAEOKAI-1BR01                      | Princeville, Hawaii            | 1     | No      |
| WYN-W-CAL-OPE-1BRMU (1)               | San Francisco, California      | 0     | Yes     |
| WYN-W-CAL-OPE-1BRMU (2)               | San Francisco, California      | 0     | Yes     |

**Notable groups:**
- **LS-CA-SR-MD-10BR01–08** (8 listings, Palm Desert CA): 10-bedroom units — all live and listed ✅
- **P-AUSTIN-1BR01–10** (10 listings, Austin TX): 1BR units — all unlisted
- **DB-AUSTIN-1BR05–10** (6 listings, Austin TX): 1BR units — all unlisted
- **RA-** (3 listings in Austin TX, Avon CO, Princeville HI): unlisted
- **JM-PATRTPLACE-1BR01–03** (2 listings, Williamsburg VA): unlisted
- **WYN-W-CAL-OPE-1BRMU (1) & (2)** (San Francisco CA): listed but missing property data (see Anomaly A)

---

## 8. Channel & Integration Status

| Check | Result |
|-------|--------|
| Listings with active channel integrations | 0 |
| Listings with channel-specific data | 0 |

No OTA/channel integrations (Airbnb, Booking.com, VRBO, etc.) are currently connected. All distribution connections will need to be configured manually in the destination account after the client has reviewed and approved the listings.

---

## 9. Recommended Actions

| Priority | Item | Action |
|----------|------|--------|
| 🔴 High | CWOR listings under ELY (Anomaly C) | Confirm with client if CWOR needs its own parent complex |
| 🔴 High | WYN-W-CAL-OPE structure (Anomaly A) | Clarify intended structure; fix bedroom/bathroom data |
| 🟡 Medium | 4 empty MTL parent complexes | Confirm if sub-units are needed or parents should be removed |
| 🟡 Medium | Zero-bathroom sub-units (37 listings) | Confirm with client; update if source data was incorrect |
| 🟡 Medium | Null bathroom data (3 listings) | Populate bathroom count on WYN-W-CAL-OPE listings |
| 🟢 Low | KEK 2BR29 gap (Anomaly B) | Verify with client if unit 29 should be added |
| 🟢 Low | 126 listings unlisted | Activate listings and connect channels when client is ready |