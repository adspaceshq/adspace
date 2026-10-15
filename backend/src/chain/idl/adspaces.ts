// Generated from adspaces-program target/idl/adspaces.json. Re-copy after every program upgrade.
import type { Adspaces } from "./adspaces-types.js";

export const ADSPACES_IDL = {
  "address": "8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5",
  "metadata": {
    "name": "adspaces",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Adspaces peer-to-peer ad-space marketplace: fixed-price claims and auctions escrowed in USDC"
  },
  "instructions": [
    {
      "name": "accept_config_authority",
      "discriminator": [
        138,
        34,
        130,
        16,
        252,
        207,
        24,
        90
      ],
      "accounts": [
        {
          "name": "proposed_authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "transfer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  95,
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "previous_authority",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "add_spot",
      "discriminator": [
        19,
        222,
        144,
        73,
        51,
        28,
        136,
        181
      ],
      "accounts": [
        {
          "name": "seller",
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "rent_payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "reviewer",
          "docs": [
            "Spots added after listing approval need the review authority's co-signature, like the listing itself."
          ],
          "signer": true
        },
        {
          "name": "review_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  118,
                  105,
                  101,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancel_config_authority",
      "discriminator": [
        13,
        66,
        89,
        171,
        84,
        217,
        93,
        155
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "transfer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  95,
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claim_spot",
      "discriminator": [
        89,
        18,
        139,
        11,
        246,
        170,
        6,
        173
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "buyer_ata",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "close_listing",
      "discriminator": [
        33,
        15,
        192,
        81,
        78,
        175,
        159,
        97
      ],
      "accounts": [
        {
          "name": "rent_payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "close_spot",
      "discriminator": [
        120,
        210,
        73,
        225,
        51,
        123,
        54,
        248
      ],
      "accounts": [
        {
          "name": "rent_payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "seller_ata",
          "docs": [
            "Receives anything sent to the open spot's vault (donations), so nobody can block closing it."
          ],
          "writable": true
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "create_listing",
      "discriminator": [
        18,
        168,
        45,
        24,
        191,
        31,
        117,
        54
      ],
      "accounts": [
        {
          "name": "seller",
          "signer": true
        },
        {
          "name": "reviewer",
          "signer": true
        },
        {
          "name": "rent_payer",
          "docs": [
            "Platform account that pays the rent for the listing and everything under it, and gets it back."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "arg",
                "path": "slug_hash"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "review_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  118,
                  105,
                  101,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "slug_hash",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "metadata_uri",
          "type": "string"
        },
        {
          "name": "mode",
          "type": "u8"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "artwork_close",
          "type": "i64"
        },
        {
          "name": "delivery_deadline",
          "type": "i64"
        },
        {
          "name": "review_window_seconds",
          "type": "i64"
        },
        {
          "name": "min_increment",
          "type": "u64"
        },
        {
          "name": "double_up",
          "type": "bool"
        },
        {
          "name": "fee_bps",
          "type": "u16"
        },
        {
          "name": "uplift_fee_bps",
          "type": "u16"
        },
        {
          "name": "max_fee_bps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initialize_config",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5"
        },
        {
          "name": "program_data"
        },
        {
          "name": "payment_mint"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "fee_bps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initialize_review_authority",
      "discriminator": [
        54,
        226,
        205,
        48,
        70,
        91,
        220,
        184
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "review_authority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  118,
                  105,
                  101,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "authority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "migrate_config",
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "pause_protocol",
      "discriminator": [
        144,
        95,
        0,
        107,
        119,
        39,
        248,
        141
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "place_bid",
      "discriminator": [
        238,
        77,
        148,
        91,
        200,
        151,
        92,
        146
      ],
      "accounts": [
        {
          "name": "bidder",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "bidder_ata",
          "writable": true
        },
        {
          "name": "prev_bidder_ata",
          "docs": [
            "Previous top bidder's USDC account. Required when outbidding;",
            "pass the program id as a placeholder for the opening bid."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "propose_config_authority",
      "discriminator": [
        31,
        229,
        9,
        231,
        45,
        153,
        123,
        235
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "transfer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  95,
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proposed_authority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "raise_dispute",
      "discriminator": [
        41,
        243,
        1,
        51,
        150,
        95,
        246,
        73
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "listing",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "rent_payer",
          "docs": [
            "The listing's rent payer funds the dispute's rent, so buyers never need SOL. Co-signs the raise."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "dispute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "evidence_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "evidence_uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "refund_spot",
      "discriminator": [
        247,
        84,
        138,
        122,
        229,
        147,
        248,
        47
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "rent_payer",
          "writable": true
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "buyer_ata",
          "writable": true
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "proof",
          "docs": [
            "Proof submitted before a seller-initiated refund; closed so its rent returns to the rent payer."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  111,
                  102
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "resolve_dispute",
      "discriminator": [
        231,
        6,
        202,
        6,
        96,
        103,
        12,
        230
      ],
      "accounts": [
        {
          "name": "resolver",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "rent_payer",
          "docs": [
            "Gets the rent back for the dispute, spot, vault and proof: the platform account that paid it."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "seller_ata",
          "writable": true
        },
        {
          "name": "seller"
        },
        {
          "name": "buyer_ata",
          "writable": true
        },
        {
          "name": "treasury_ata",
          "writable": true
        },
        {
          "name": "proof",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  111,
                  102
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "seller_share_bps",
          "type": "u16"
        },
        {
          "name": "decision_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "decision_uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "set_dispute_timeout",
      "discriminator": [
        98,
        240,
        248,
        196,
        183,
        236,
        131,
        111
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "seconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "submit_proof",
      "discriminator": [
        54,
        241,
        46,
        84,
        4,
        212,
        46,
        94
      ],
      "accounts": [
        {
          "name": "seller",
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "rent_payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "proof",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  111,
                  102
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proof_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "proof_uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "timeout_dispute",
      "discriminator": [
        19,
        170,
        251,
        157,
        113,
        142,
        68,
        143
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "rent_payer",
          "docs": [
            "Gets the rent back for the dispute, spot, vault and proof: the platform account that paid it."
          ],
          "writable": true
        },
        {
          "name": "proof",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  111,
                  102
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "buyer_ata",
          "writable": true
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "update_config",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "fee_bps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "update_review_authority",
      "discriminator": [
        243,
        170,
        135,
        199,
        126,
        86,
        85,
        242
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "review_authority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  118,
                  105,
                  101,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "new_authority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdraw_dispute",
      "discriminator": [
        96,
        143,
        114,
        202,
        143,
        131,
        26,
        134
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "rent_payer",
          "docs": [
            "Gets the dispute's rent back: the platform account that paid it."
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "withdraw_seller",
      "discriminator": [
        36,
        53,
        86,
        71,
        125,
        229,
        115,
        98
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.seller",
                "account": "Listing"
              },
              {
                "kind": "account",
                "path": "listing.slug_hash",
                "account": "Listing"
              }
            ]
          }
        },
        {
          "name": "seller"
        },
        {
          "name": "rent_payer",
          "writable": true
        },
        {
          "name": "spot",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "seller_ata",
          "writable": true
        },
        {
          "name": "treasury_ata",
          "writable": true
        },
        {
          "name": "proof",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  111,
                  102
                ]
              },
              {
                "kind": "account",
                "path": "spot"
              }
            ]
          }
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "AuthorityTransfer",
      "discriminator": [
        43,
        243,
        199,
        71,
        139,
        255,
        231,
        113
      ]
    },
    {
      "name": "Config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "DisputeRecord",
      "discriminator": [
        198,
        199,
        79,
        209,
        12,
        215,
        34,
        47
      ]
    },
    {
      "name": "Listing",
      "discriminator": [
        218,
        32,
        50,
        73,
        43,
        134,
        26,
        58
      ]
    },
    {
      "name": "ProofRecord",
      "discriminator": [
        237,
        59,
        155,
        172,
        204,
        117,
        87,
        44
      ]
    },
    {
      "name": "ReviewAuthority",
      "discriminator": [
        39,
        129,
        58,
        159,
        213,
        93,
        128,
        56
      ]
    },
    {
      "name": "Spot",
      "discriminator": [
        146,
        3,
        218,
        110,
        245,
        121,
        210,
        110
      ]
    }
  ],
  "events": [
    {
      "name": "BidPlaced",
      "discriminator": [
        135,
        53,
        176,
        83,
        193,
        69,
        108,
        61
      ]
    },
    {
      "name": "BidRefunded",
      "discriminator": [
        197,
        100,
        31,
        186,
        67,
        28,
        46,
        103
      ]
    },
    {
      "name": "ConfigAuthorityAccepted",
      "discriminator": [
        166,
        249,
        198,
        239,
        64,
        193,
        191,
        242
      ]
    },
    {
      "name": "ConfigAuthorityCancelled",
      "discriminator": [
        156,
        243,
        236,
        66,
        7,
        170,
        51,
        68
      ]
    },
    {
      "name": "ConfigAuthorityProposed",
      "discriminator": [
        125,
        29,
        33,
        186,
        153,
        16,
        155,
        229
      ]
    },
    {
      "name": "ConfigInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "ConfigUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "DeadlineExtended",
      "discriminator": [
        100,
        53,
        50,
        91,
        205,
        71,
        0,
        103
      ]
    },
    {
      "name": "DisputeRaised",
      "discriminator": [
        246,
        167,
        109,
        37,
        142,
        45,
        38,
        176
      ]
    },
    {
      "name": "DisputeResolved",
      "discriminator": [
        121,
        64,
        249,
        153,
        139,
        128,
        236,
        187
      ]
    },
    {
      "name": "DisputeTimedOut",
      "discriminator": [
        137,
        64,
        237,
        240,
        254,
        236,
        189,
        185
      ]
    },
    {
      "name": "DisputeTimeoutUpdated",
      "discriminator": [
        92,
        173,
        201,
        161,
        197,
        205,
        163,
        224
      ]
    },
    {
      "name": "DisputeWithdrawn",
      "discriminator": [
        147,
        89,
        73,
        230,
        12,
        0,
        182,
        175
      ]
    },
    {
      "name": "ListingClosed",
      "discriminator": [
        86,
        219,
        253,
        196,
        184,
        194,
        176,
        78
      ]
    },
    {
      "name": "ListingCreated",
      "discriminator": [
        94,
        164,
        167,
        255,
        246,
        186,
        12,
        96
      ]
    },
    {
      "name": "ProofSubmitted",
      "discriminator": [
        160,
        51,
        85,
        70,
        249,
        89,
        5,
        139
      ]
    },
    {
      "name": "ProtocolPauseSet",
      "discriminator": [
        88,
        186,
        42,
        175,
        234,
        40,
        83,
        247
      ]
    },
    {
      "name": "ReviewAuthorityInitialized",
      "discriminator": [
        99,
        49,
        172,
        28,
        72,
        5,
        9,
        12
      ]
    },
    {
      "name": "ReviewAuthorityUpdated",
      "discriminator": [
        181,
        67,
        28,
        35,
        16,
        19,
        41,
        103
      ]
    },
    {
      "name": "SellerWithdrawn",
      "discriminator": [
        81,
        28,
        146,
        232,
        131,
        39,
        55,
        139
      ]
    },
    {
      "name": "SpotAdded",
      "discriminator": [
        64,
        116,
        177,
        166,
        91,
        73,
        166,
        64
      ]
    },
    {
      "name": "SpotClaimed",
      "discriminator": [
        156,
        166,
        249,
        195,
        165,
        103,
        131,
        95
      ]
    },
    {
      "name": "SpotClosed",
      "discriminator": [
        58,
        154,
        251,
        184,
        254,
        141,
        241,
        9
      ]
    },
    {
      "name": "SpotRefunded",
      "discriminator": [
        81,
        189,
        178,
        172,
        226,
        43,
        24,
        16
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidMode",
      "msg": "Unknown pricing mode. Use 0 for fixed-price, 1 for auction."
    },
    {
      "code": 6001,
      "name": "InvalidDeadline",
      "msg": "Deadline must be in the future."
    },
    {
      "code": 6002,
      "name": "InvalidArtworkClose",
      "msg": "Artwork close must not be before the deadline."
    },
    {
      "code": 6003,
      "name": "InvalidDeliveryDeadline",
      "msg": "Delivery deadline must be after artwork close."
    },
    {
      "code": 6004,
      "name": "InvalidReviewWindow",
      "msg": "Review window is outside the allowed range."
    },
    {
      "code": 6005,
      "name": "InvalidMinIncrement",
      "msg": "Auction without double-up needs a minimum increment above zero."
    },
    {
      "code": 6006,
      "name": "MetadataUriTooLong",
      "msg": "Metadata URI is too long."
    },
    {
      "code": 6007,
      "name": "InvalidMint",
      "msg": "Mint is not a known USDC mint (devnet or mainnet-beta)."
    },
    {
      "code": 6008,
      "name": "InvalidFeeBps",
      "msg": "Fee must be at most 10,000 basis points."
    },
    {
      "code": 6009,
      "name": "ListingClosed",
      "msg": "Listing is past its deadline."
    },
    {
      "code": 6010,
      "name": "ListingNotOpen",
      "msg": "Listing is not open."
    },
    {
      "code": 6011,
      "name": "SpotNotOpen",
      "msg": "Spot is not open for claims or bids."
    },
    {
      "code": 6012,
      "name": "SpotAlreadyFunded",
      "msg": "Spot was already paid. Seller withdraw or cancel only."
    },
    {
      "code": 6013,
      "name": "WrongMode",
      "msg": "This instruction does not match the listing pricing mode."
    },
    {
      "code": 6014,
      "name": "ZeroPrice",
      "msg": "Spot price must be above zero."
    },
    {
      "code": 6015,
      "name": "TooManySpots",
      "msg": "Listing already has the maximum of 60 spots."
    },
    {
      "code": 6016,
      "name": "FirstBidTooLow",
      "msg": "First bid must meet the starting price."
    },
    {
      "code": 6017,
      "name": "BidTooLow",
      "msg": "Bid must beat the current bid by the minimum increment."
    },
    {
      "code": 6018,
      "name": "BidMustDouble",
      "msg": "Takeover bid must be at least double the current bid."
    },
    {
      "code": 6019,
      "name": "WithdrawTooEarly",
      "msg": "Settlement is only available after the deadline."
    },
    {
      "code": 6020,
      "name": "SpotNotFunded",
      "msg": "Spot has no funds to withdraw."
    },
    {
      "code": 6021,
      "name": "VaultNotEmpty",
      "msg": "Vault still holds funds. Only unfunded spots can be closed."
    },
    {
      "code": 6022,
      "name": "Unauthorized",
      "msg": "Only the seller can perform this action."
    },
    {
      "code": 6023,
      "name": "MissingRefundAccount",
      "msg": "Previous bidder token account is required to refund an outbid."
    },
    {
      "code": 6024,
      "name": "MathOverflow",
      "msg": "Arithmetic overflow."
    },
    {
      "code": 6025,
      "name": "ProofRequired",
      "msg": "Proof is required before settlement."
    },
    {
      "code": 6026,
      "name": "ProofAlreadySubmitted",
      "msg": "Proof was already submitted."
    },
    {
      "code": 6027,
      "name": "InvalidProof",
      "msg": "Proof hash cannot be empty."
    },
    {
      "code": 6028,
      "name": "ReviewWindowOpen",
      "msg": "Buyer review period is still open."
    },
    {
      "code": 6029,
      "name": "ReviewWindowClosed",
      "msg": "Buyer review period has ended."
    },
    {
      "code": 6030,
      "name": "NotWinningBuyer",
      "msg": "Only the winning buyer can dispute this spot."
    },
    {
      "code": 6031,
      "name": "ProofDeadlinePassed",
      "msg": "Delivery deadline has passed; proof can no longer be submitted."
    },
    {
      "code": 6032,
      "name": "DeliveryDeadlinePending",
      "msg": "Delivery deadline has not passed yet."
    },
    {
      "code": 6033,
      "name": "ProofExists",
      "msg": "Proof exists; refund requires dispute resolution or seller cancellation."
    },
    {
      "code": 6034,
      "name": "InvalidProofUri",
      "msg": "Proof URI must be nonempty and at most 200 bytes."
    },
    {
      "code": 6035,
      "name": "InvalidDisputeEvidence",
      "msg": "Dispute evidence hash and URI must both be present or both absent, and URI at most 200 bytes."
    },
    {
      "code": 6036,
      "name": "InvalidDecisionEvidence",
      "msg": "Decision hash and URI must be present, and URI at most 200 bytes."
    },
    {
      "code": 6037,
      "name": "InvalidAuthorityTransfer",
      "msg": "Proposed authority must be a different, nondefault address."
    },
    {
      "code": 6038,
      "name": "InvalidConfigAuthority",
      "msg": "Only the program upgrade authority can initialize config."
    },
    {
      "code": 6039,
      "name": "InvalidReviewAuthority",
      "msg": "Only the configured review authority can approve a listing."
    },
    {
      "code": 6040,
      "name": "InvalidFeePolicy",
      "msg": "Listing fee policy is invalid for its pricing mode."
    },
    {
      "code": 6041,
      "name": "ListingHasActiveSpots",
      "msg": "Listing still has active spots."
    },
    {
      "code": 6042,
      "name": "ListingStillActive",
      "msg": "Listing deadline has not passed yet."
    },
    {
      "code": 6043,
      "name": "ProtocolPaused",
      "msg": "Protocol is paused."
    },
    {
      "code": 6044,
      "name": "SelfDealing",
      "msg": "Seller cannot buy or bid on their own listing."
    },
    {
      "code": 6045,
      "name": "DisputeNotTimedOut",
      "msg": "Dispute has not timed out yet."
    },
    {
      "code": 6046,
      "name": "InvalidDisputeTimeout",
      "msg": "Dispute timeout is outside the allowed range."
    }
  ],
  "types": [
    {
      "name": "AuthorityTransfer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "current_authority",
            "type": "pubkey"
          },
          {
            "name": "proposed_authority",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "BidPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "BidRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "payment_mint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "paused",
            "docs": [
              "Appended after `bump` so pre-pause config accounts migrate by realloc alone."
            ],
            "type": "bool"
          },
          {
            "name": "dispute_timeout_seconds",
            "docs": [
              "Appended last; how long an unresolved dispute stays open before the buyer can be refunded."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ConfigAuthorityAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous_authority",
            "type": "pubkey"
          },
          {
            "name": "new_authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "ConfigAuthorityCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "proposed_authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "ConfigAuthorityProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "current_authority",
            "type": "pubkey"
          },
          {
            "name": "proposed_authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "ConfigInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "payment_mint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ConfigUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "DeadlineExtended",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "previous_deadline",
            "type": "i64"
          },
          {
            "name": "new_deadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "DisputeRaised",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "proof_submitted",
            "type": "bool"
          },
          {
            "name": "evidence_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "raised_at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "DisputeRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "spot",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "rent_payer",
            "docs": [
              "Platform account that paid the dispute's rent; the rent returns here when the dispute closes."
            ],
            "type": "pubkey"
          },
          {
            "name": "proof_submitted",
            "type": "bool"
          },
          {
            "name": "evidence_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "evidence_uri",
            "type": "string"
          },
          {
            "name": "opened_at",
            "type": "i64"
          },
          {
            "name": "timeout_seconds",
            "docs": [
              "Timeout captured when the dispute was raised, so later config changes can't cut it short."
            ],
            "type": "i64"
          },
          {
            "name": "decision_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "decision_uri",
            "type": "string"
          },
          {
            "name": "decided_at",
            "type": "i64"
          },
          {
            "name": "seller_share_bps",
            "type": "u16"
          },
          {
            "name": "buyer_refund",
            "type": "u64"
          },
          {
            "name": "seller_amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "DisputeResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "decision_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "seller_share_bps",
            "type": "u16"
          },
          {
            "name": "buyer_refund",
            "type": "u64"
          },
          {
            "name": "seller_amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "DisputeTimedOut",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "DisputeTimeoutUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous_seconds",
            "type": "i64"
          },
          {
            "name": "new_seconds",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "DisputeWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "Listing",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "slug_hash",
            "docs": [
              "First 16 bytes of sha256(slug)."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "metadata_uri",
            "type": "string"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "mode",
            "type": "u8"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "artwork_close",
            "type": "i64"
          },
          {
            "name": "delivery_deadline",
            "type": "i64"
          },
          {
            "name": "review_window_seconds",
            "type": "i64"
          },
          {
            "name": "min_increment",
            "type": "u64"
          },
          {
            "name": "double_up",
            "type": "bool"
          },
          {
            "name": "spot_count",
            "type": "u8"
          },
          {
            "name": "closed_spot_count",
            "docs": [
              "Spots already closed (paid out, refunded, settled by dispute or withdrawn unsold)."
            ],
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          },
          {
            "name": "uplift_fee_bps",
            "type": "u16"
          },
          {
            "name": "max_fee_bps",
            "type": "u16"
          },
          {
            "name": "rent_payer",
            "docs": [
              "Platform account that paid the rent for this listing and its spots, vaults and proofs.",
              "Every one of those accounts returns its rent here when it closes."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ListingClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "ListingCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "slug_hash",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "mode",
            "type": "u8"
          },
          {
            "name": "review_window_seconds",
            "type": "i64"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          },
          {
            "name": "uplift_fee_bps",
            "type": "u16"
          },
          {
            "name": "max_fee_bps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ProofRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "spot",
            "type": "pubkey"
          },
          {
            "name": "proof_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proof_uri",
            "type": "string"
          },
          {
            "name": "submitted_at",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ProofSubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "proof",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "proof_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "submitted_at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ProtocolPauseSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "ReviewAuthority",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ReviewAuthorityInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "ReviewAuthorityUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous_authority",
            "type": "pubkey"
          },
          {
            "name": "new_authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "SellerWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Spot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "current_bid",
            "type": "u64"
          },
          {
            "name": "current_bidder",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vault_bump",
            "type": "u8"
          },
          {
            "name": "proof_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proof_submitted_at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "SpotAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SpotClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SpotClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "SpotRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "seller_initiated",
            "type": "bool"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "AUTHORITY_TRANSFER_SEED",
      "type": "bytes",
      "value": "[97, 117, 116, 104, 111, 114, 105, 116, 121, 95, 116, 114, 97, 110, 115, 102, 101, 114]"
    },
    {
      "name": "CONFIG_SEED",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "DEFAULT_DISPUTE_TIMEOUT_SECONDS",
      "type": "i64",
      "value": "259200"
    },
    {
      "name": "DEFAULT_REVIEW_WINDOW_SECONDS",
      "type": "i64",
      "value": "172800"
    },
    {
      "name": "DISPUTE_SEED",
      "type": "bytes",
      "value": "[100, 105, 115, 112, 117, 116, 101]"
    },
    {
      "name": "LISTING_CLOSED",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "LISTING_OPEN",
      "type": "u8",
      "value": "0"
    },
    {
      "name": "LISTING_SEED",
      "type": "bytes",
      "value": "[108, 105, 115, 116, 105, 110, 103]"
    },
    {
      "name": "MAX_DISPUTE_TIMEOUT_SECONDS",
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "MAX_REVIEW_WINDOW_SECONDS",
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "MAX_SPOTS_PER_LISTING",
      "type": "u8",
      "value": "60"
    },
    {
      "name": "MIN_BID_INCREMENT",
      "docs": [
        "Smallest allowed auction bid step, in USDC base units (6 decimals): 0.01 USDC."
      ],
      "type": "u64",
      "value": "10000"
    },
    {
      "name": "MIN_DISPUTE_TIMEOUT_SECONDS",
      "type": "i64",
      "value": "3600"
    },
    {
      "name": "MIN_REVIEW_WINDOW_SECONDS",
      "type": "i64",
      "value": "3600"
    },
    {
      "name": "MODE_AUCTION",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "MODE_FIXED",
      "type": "u8",
      "value": "0"
    },
    {
      "name": "PROOF_SEED",
      "type": "bytes",
      "value": "[112, 114, 111, 111, 102]"
    },
    {
      "name": "REVIEW_AUTHORITY_SEED",
      "type": "bytes",
      "value": "[114, 101, 118, 105, 101, 119, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "SNIPE_EXTENSION_SECONDS",
      "type": "i64",
      "value": "300"
    },
    {
      "name": "SNIPE_WINDOW_SECONDS",
      "type": "i64",
      "value": "300"
    },
    {
      "name": "SPOT_CANCELLED",
      "type": "u8",
      "value": "3"
    },
    {
      "name": "SPOT_DISPUTED",
      "type": "u8",
      "value": "4"
    },
    {
      "name": "SPOT_FINALIZED",
      "type": "u8",
      "value": "2"
    },
    {
      "name": "SPOT_FUNDED",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "SPOT_OPEN",
      "type": "u8",
      "value": "0"
    },
    {
      "name": "SPOT_SEED",
      "type": "bytes",
      "value": "[115, 112, 111, 116]"
    },
    {
      "name": "USDC_MINT_DEVNET",
      "type": "string",
      "value": "\"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU\""
    },
    {
      "name": "USDC_MINT_MAINNET",
      "type": "string",
      "value": "\"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\""
    },
    {
      "name": "VAULT_SEED",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
} as unknown as Adspaces;

export type { Adspaces };
