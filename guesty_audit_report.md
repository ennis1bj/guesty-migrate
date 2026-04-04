# Destination Guesty Account — Audit Report
**Date:** April 4, 2026  
**Migration ID:** 2014a96a-386b-46fb-b49c-2d09d843f4c2  
**Last Updated:** April 4, 2026 (post-remediation)

---

## Post-Remediation Summary

All high and medium priority items identified in the initial audit have been resolved. The following actions were completed after the initial audit:

| Action | Result |
|--------|--------|
| Deleted 4 empty MTL parent complexes | ✅ Done — 0 empty parents remain |
| Created WYN-SE-SC-CWOR-1BRMU parent complex from source | ✅ Done |
| Re-parented all 13 CWOR/Ocean Ridge sub-units to new CWOR parent | ✅ Done |
| Deleted WYN-SE-CAR-ELY-STUMU parent (now empty after re-parent) | ✅ Done |
| Deleted WYN-W-CAL-OPE-1BRMU MTL parent (was empty shell) | ✅ Done |
| Fixed bathrooms on both WYN-W-CAL-OPE SINGLE listings to 1 | ✅ Done |
| Fixed bathrooms on all 25 KEK Studio sub-units (0 → 1) | ✅ Done |
| Fixed bathrooms on all 3 KEK 2BR sub-units (0 → 2) | ✅ Done |
| Fixed bathrooms on 22 CAL/MU sub-units across MAR and WYN complexes | ✅ Done |
| Recreated missing SL-SE-SC-CWOR-1BR12 (was absent from destination) | ✅ Done |
| Confirmed KEK 2BR29 does not exist in source — no action needed | ✅ Done |
| 2 CWOR sub-units (1BR03, 1BR10) remain at bathrooms=0 | ⚠️ Guesty API limitation — see note below |

**Note on CWOR bathroom field:** The Guesty API resets the `bathrooms` field asynchronously after creation for these two specific sub-unit listings. The parent complex (WYN-SE-SC-CWOR-1BRMU) correctly shows bathrooms=1 and all other 11 of 13 CWOR children show bathrooms=1. These two listings can be corrected manually in the Guesty dashboard if needed.

---

## Executive Summary

The destination Guesty account contains **133 listings** across **32 multi-unit (MTL) parent complexes** and **31 standalone single listings**, totalling **70 MTL sub-unit children**.

**Post-remediation scorecard:**

| Area | Status | Detail |
|------|--------|--------|
| MTL parent–child integrity | ✅ Clean | All 70 children have valid parent references, 0 orphans |
| Empty MTL parent complexes | ✅ Clean | 0 empty parent complexes (4 were deleted) |
| CWOR complex structure | ✅ Clean | Dedicated CWOR parent created; all 13 sub-units re-parented |
| Photo coverage | ✅ Clean | 0 listings without photos |
| Description completeness | ✅ Clean | 0 listings without public description |
| Address & coordinates | ✅ Clean | All listings have full address + lat/lng |
| Base pricing | ✅ Clean | All listings have a base price |
| Tags | ✅ Clean | All listings have tags |
| KEK Studio bathrooms | ✅ Fixed | All 25 sub-units now show bathrooms=1 |
| KEK 2BR bathrooms | ✅ Fixed | All 3 sub-units now show bathrooms=2 |
| CAL/MU sub-unit bathrooms | ✅ Fixed | All corrected from source values |
| CWOR sub-unit bathrooms | ⚠️ 11/13 fixed | 2 sub-units (1BR03, 1BR10) reset to 0 by Guesty API |
| Listing status (isListed) | ℹ️ Note | 10 of 133 listings are live on channels (see §4) |
| WYN-W-CAL-OPE anomaly | ℹ️ Client action | 2 SINGLEs live with bathrooms=1; intended structure TBD by client |
| KEK 2BR gap | ℹ️ Confirmed | 2BR29 does not exist in source — intentional gap |

---

## 1. Inventory Overview

| Category | Count |
|----------|-------|
| Total listings | **133** |
| MTL parent complexes | **32** |
| MTL child sub-unit listings | **70** |
| Single / standalone listings | **31** |
| Listings marked isListed = true | **10** |
| Listings marked isListed = false | **123** |
| Primary property type | Condominium |
| Countries | United States (132), U.S. Virgin Islands (1) |

---

## 2. Geographic Distribution

| State / Region            | Count |
|---------------------------|-------|
| Hawaii                    | 43    |
| Texas                     | 21    |
| South Carolina            | 20    |
| Colorado                  | 15    |
| California                | 10    |
| Georgia                   | 8     |
| Virginia                  | 4     |
| Vermont                   | 4     |
| Florida                   | 4     |
| New Jersey                | 2     |
| Tennessee                 | 2     |
| Missouri                  | 1     |
| Oklahoma                  | 1     |
| St. Thomas (USVI)         | 1     |

Hawaii has the largest concentration of listings (43), followed by Texas (21) and South Carolina (20).

---

## 3. MTL Complex Structure

All 32 MTL parent complexes and their sub-unit counts. (4 formerly empty parent complexes have been deleted.)

| Complex (Parent)                      | Sub-units | Location                           | Beds  | Baths  | Sleeps |
|---------------------------------------|-----------|-------------------------------------|-------|--------|--------|
| MAR-CO-SSR-1BRMU                      | 1         | Steamboat Springs, Colorado         | 1     | 1      | 4      |
| MAR-CO-SSR-2BRMU                      | 1         | Steamboat Springs, Colorado         | 2     | 2      | 6      |
| MAR-CO-SSR-3BRMU                      | 1         | Steamboat Springs, Colorado         | 3     | 3      | 8      |
| MAR-CO-SSR-4BRMU                      | 1         | Steamboat Springs, Colorado         | 4     | 4      | 12     |
| MAR-CO-SSR-HOTMU                      | 1         | Steamboat Springs, Colorado         | 0     | 1      | 2      |
| MAR-CO-SSR-STUMU                      | 1         | Steamboat Springs, Colorado         | 0     | 1      | 4      |
| MAR-HI-SKRV-STUMU                     | 1         | Koloa, Hawaii                       | 0     | 1      | 2      |
| MAR-HI-WKORV-1BRMU                    | 1         | Lahaina, Hawaii                     | 1     | 1      | 4      |
| MAR-HI-WKORV-2BRMU                    | 1         | Lahaina, Hawaii                     | 2     | 2      | 8      |
| MAR-HI-WKORV-STMU                     | 1         | Lahaina, Hawaii                     | 0     | 1      | 4      |
| MAR-HI-WPOR-1BRMU                     | 1         | Princeville, Hawaii                 | 1     | 1      | 4      |
| MAR-HI-WPOR-2BRMU                     | 1         | Princeville, Hawaii                 | 2     | 0      | 8      |
| WYN-C-TEX-LC-3BRMU                    | 1         | San Antonio, Texas                  | 3     | 3      | 8      |
| WYN-C-TEX-LC-4BRMU                    | 1         | San Antonio, Texas                  | 4     | 4      | 10     |
| WYN-C-W-SS-3BRMU                      | 1         | Steamboat Springs, Colorado         | 3     | 2      | 8      |
| WYN-E-EC-CWOTA-1BRMU                  | 1         | Alexandria, Virginia                | 1     | 1      | 4      |
| WYN-E-EC-CWSKY-3BRMU                  | 1         | Atlantic City, New Jersey           | 3     | 2      | 8      |
| WYN-E-NE-CWSNH-1BRMU                  | 1         | Cambridge, Vermont                  | 1     | 1      | 6      |
| WYN-E-NE-CWSNH-2BRMU                  | 1         | Cambridge, Vermont                  | 2     | 2      | 8      |
| WYN-E-T-MARG-STUMU                    | 1         | Nashville, Tennessee                | 0     | 1      | 4      |
| WYN-SE-C-CWCP-2BRMU                   | 1         | Kissimmee, Florida                  | 2     | 2      | 8      |
| WYN-SE-C-CWSI-3BRMU                   | 1         | Kissimmee, Florida                  | 3     | 2      | 10     |
| WYN-SE-G-MARG-1BRMU                   | 1         | Atlanta, Georgia                    | 1     | 1      | 4      |
| WYN-SE-G-MARG-2BRMU                   | 1         | Atlanta, Georgia                    | 2     | 2      | 8      |
| WYN-SE-G-MARG-3BRMU                   | 1         | Atlanta, Georgia                    | 3     | 2.5    | 12     |
| WYN-SE-G-MARG-STUMU                   | 1         | Atlanta, Georgia                    | 0     | 1      | 4      |
| WYN-SE-SC-CWLM-2BRMU                  | 1         | Santee, South Carolina              | 2     | 2      | 6      |
| WYN-SE-SC-CWLM-3BRMU                  | 1         | Santee, South Carolina              | 3     | 3      | 10     |
| WYN-SE-SC-CWOR-1BRMU *(new)*          | 13        | Edisto Beach, South Carolina        | 1     | 1      | 4      |
| WYN-SE-SC-CWWW-1BRMU                  | 1         | North Myrtle Beach, South Carolina  | 1     | 1      | 4      |
| WYN-W-HI-KEK-2BRMU                    | 3         | Princeville, Hawaii                 | 2     | 2      | 6      |
| WYN-W-HI-KEK-STUMU                    | 25        | Princeville, Hawaii                 | 0     | 1      | 2      |

### 3a. WYN-SE-SC-CWOR-1BRMU — Ocean Ridge Sub-Units (13)

A new CWOR parent complex was created from the source account and all 13 Ocean Ridge sub-units were re-parented from the former ELY complex. The ELY parent was then deleted.

| Sub-unit | Bathrooms |
|----------|-----------|
| LS-OCEANRIDGE-1BR05 | 1 ✅ |
| LS-SE-SC-CWOR-1BR01 | 1 ✅ |
| LS-SE-SC-CWOR-1BR03 | 0 ⚠️ |
| LS-SE-SC-CWOR-1BR04 | 1 ✅ |
| LS-SE-SC-CWOR-1BR05 | 1 ✅ |
| LS-SE-SC-CWOR-1BR07 | 1 ✅ |
| LS-SE-SC-CWOR-1BR08 | 1 ✅ |
| LS-SE-SC-CWOR-1BR09 | 1 ✅ |
| LS-SE-SC-CWOR-1BR10 | 0 ⚠️ |
| LSE-SE-SC-CWOR-1BR02 | 1 ✅ |
| LSE-SE-SC-CWOR-1BR04 | 1 ✅ |
| SL-SE-SC-CWOR-1BR12 | 1 ✅ |
| SL-SE-SC-CWOR-1BR14 | 1 ✅ |

**Note on 1BR03 and 1BR10:** Multiple delete+recreate attempts with `bathrooms: 1` in the POST payload were made. The creation response shows `bathrooms: 1` but Guesty's system resets the field to 0 asynchronously within seconds. All other 11 sub-units hold bathrooms=1 correctly. This appears to be a Guesty API enforcement behavior specific to these two listings. They can be corrected directly in the Guesty dashboard under Property → Amenities.

**Note on SL-SE-SC-CWOR-1BR12:** This listing was absent from the destination account. It was recreated from source data and is now present with correct configuration.

### 3b. WYN-W-HI-KEK-STUMU — Studio Sub-Units (25)

All 25 Kekaha Studio sub-units (LW-W-HI-KEK-STU01 through STU25) are correctly linked to the KEK Studio parent. Bathrooms were corrected from 0 → 1 on all 25 listings. ✅

### 3c. WYN-W-HI-KEK-2BRMU — 2-Bedroom Sub-Units (3)

The KEK 2BR complex has 3 child listings: 2BR27, 2BR28, 2BR30. Bathrooms corrected from 0 → 2 on all 3. **Unit 2BR29 was confirmed absent from the source account as well — this is an intentional gap, no action needed.** ✅

### 3d. MAR-HI-WPOR-2BRMU

This parent shows bathrooms=0. The source account also has bathrooms=0 for this complex — this is the original source data and was not changed.

---

## 4. Listing Status

**10 of 133** listings have isListed = true and are live on booking channels:

| Listing(s) | Type | Location | Count |
|------------|------|----------|-------|
| LS-CA-SR-MD-10BR01 through 10BR08 | SINGLE | Palm Desert, CA | 8 |
| WYN-W-CAL-OPE-1BRMU (1) & (2) | SINGLE | San Francisco, CA | 2 |

**123 listings are not published to any channel.** This is expected immediately after a data migration — channel connections are configured manually post-migration. No corrective action is needed unless the client expects additional listings to be live.

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
| MTL children with invalid parent reference | ✅ Pass | 0 |
| Orphaned MTL children | ✅ Pass | 0 |
| Empty MTL parent complexes | ✅ Pass | 0 |
| Listings with no tags | ✅ Pass | 0 |
| KEK Studio bathrooms | ✅ Fixed | All 25 = 1 |
| KEK 2BR bathrooms | ✅ Fixed | All 3 = 2 |
| CWOR sub-unit bathrooms | ⚠️ 11/13 | 1BR03 & 1BR10 show 0 (API limitation) |
| MAR-HI-WPOR-2BRMU bathrooms | ℹ️ Source | bathrooms=0 matches source account |

---

## 6. Anomalies — Client Action Required

### Anomaly A — WYN-W-CAL-OPE Structure (San Francisco, CA)

The original audit found 3 listings sharing the "WYN-W-CAL-OPE-1BRMU" nickname: an MTL parent (empty, no sub-units) and 2 SINGLE listings both live on channels.

**Remediation applied:**
- The empty MTL parent was deleted
- Both SINGLE listings had bathrooms corrected from null → 1

**Remaining client decision:** Both SINGLE listings remain live. The client should confirm the intended structure:
- **(a) Keep as 2 standalone SINGLEs** — no further action needed
- **(b) Convert to an MTL complex** — a new parent would need to be created and both SINGLEs converted to MTL_CHILD type

Additionally, both listings currently show bedrooms=0. If these are 1-bedroom units, the bedroom count should be updated.

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
| WYN-W-CAL-OPE-1BRMU (1)              | San Francisco, California      | 0     | Yes     |
| WYN-W-CAL-OPE-1BRMU (2)              | San Francisco, California      | 0     | Yes     |

**Notable groups:**
- **LS-CA-SR-MD-10BR01–08** (8 listings, Palm Desert CA): 10-bedroom units — all live and listed ✅
- **P-AUSTIN-1BR01–10** (10 listings, Austin TX): 1BR units — all unlisted
- **DB-AUSTIN-1BR05–10** (6 listings, Austin TX): 1BR units — all unlisted
- **RA-** (3 listings in Austin TX, Avon CO, Princeville HI): unlisted
- **JM-PATRTPLACE-1BR01 & 1BR03** (Williamsburg VA): unlisted (note: 1BR02 is absent)
- **WYN-W-CAL-OPE-1BRMU (1) & (2)** (San Francisco CA): listed; bedroom/bathroom data needs client clarification (see §6)

---

## 8. Channel & Integration Status

| Check | Result |
|-------|--------|
| Listings with active channel integrations | 0 |
| Listings with channel-specific data | 0 |

No OTA/channel integrations (Airbnb, Booking.com, VRBO, etc.) are currently connected. All distribution connections will need to be configured manually in the destination account after the client has reviewed and approved the listings.

---

## 9. Remaining Client Actions

| Priority | Item | Action Required |
|----------|------|-----------------|
| 🟡 Medium | WYN-W-CAL-OPE structure (2 live SINGLEs) | Confirm: keep as SINGLEs or convert to MTL complex? Fix bedrooms if 1BR. |
| 🟢 Low | CWOR sub-units 1BR03 & 1BR10 (baths=0) | Fix manually in Guesty dashboard: Property → Amenities → Bathrooms → 1 |
| 🟢 Low | MAR-HI-WPOR-2BRMU (baths=0) | Confirm with client — source account also shows 0 for this complex |
