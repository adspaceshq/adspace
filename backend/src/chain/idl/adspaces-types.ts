/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/adspaces.json`.
 */
export type Adspaces = {
  "address": "6ft49ExLRbHUcY6crReW7qibZLrS5rdCudKWQRp2LMSW",
  "metadata": {
    "name": "adspaces",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Adspaces peer-to-peer ad-space marketplace: fixed-price claims and auctions escrowed in USDC"
  },
  "instructions": [
    {
      "name": "acceptConfigAuthority",
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
          "name": "proposedAuthority",
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
          "name": "previousAuthority",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "addSpot",
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
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
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
                "path": "listing.slugHash",
                "account": "listing"
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
          "name": "usdcMint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
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
      "name": "cancelConfigAuthority",
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
      "name": "claimSpot",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
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
          "name": "buyerAta",
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
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeListing",
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
          "name": "seller",
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
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
                "path": "listing.slugHash",
                "account": "listing"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeSpot",
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
          "name": "seller",
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
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
                "path": "listing.slugHash",
                "account": "listing"
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createListing",
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
          "writable": true,
          "signer": true
        },
        {
          "name": "reviewer",
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
                "path": "slugHash"
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
          "name": "reviewAuthority",
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
          "name": "usdcMint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "slugHash",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "metadataUri",
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
          "name": "artworkClose",
          "type": "i64"
        },
        {
          "name": "deliveryDeadline",
          "type": "i64"
        },
        {
          "name": "reviewWindowSeconds",
          "type": "i64"
        },
        {
          "name": "minIncrement",
          "type": "u64"
        },
        {
          "name": "doubleUp",
          "type": "bool"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "upliftFeeBps",
          "type": "u16"
        },
        {
          "name": "maxFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializeConfig",
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
          "address": "6ft49ExLRbHUcY6crReW7qibZLrS5rdCudKWQRp2LMSW"
        },
        {
          "name": "programData"
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializeReviewAuthority",
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
          "name": "reviewAuthority",
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
          "name": "systemProgram",
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
      "name": "migrateConfig",
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "pauseProtocol",
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
      "name": "placeBid",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
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
          "name": "bidderAta",
          "writable": true
        },
        {
          "name": "prevBidderAta",
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
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
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
      "name": "proposeConfigAuthority",
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proposedAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "raiseDispute",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "evidenceHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "evidenceUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "refundSpot",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
              }
            ]
          }
        },
        {
          "name": "seller",
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
          "name": "buyerAta",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "resolveDispute",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
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
          "name": "vault",
          "writable": true
        },
        {
          "name": "sellerAta",
          "writable": true
        },
        {
          "name": "seller",
          "writable": true
        },
        {
          "name": "buyerAta",
          "writable": true
        },
        {
          "name": "treasuryAta",
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
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "sellerShareBps",
          "type": "u16"
        },
        {
          "name": "decisionHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "decisionUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "setDisputeTimeout",
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
      "name": "submitProof",
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
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
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
                "path": "listing.slugHash",
                "account": "listing"
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proofHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "proofUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "timeoutDispute",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
              }
            ]
          }
        },
        {
          "name": "seller",
          "writable": true
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
          "name": "buyerAta",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
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
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updateReviewAuthority",
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
          "name": "reviewAuthority",
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
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdrawDispute",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
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
        }
      ],
      "args": []
    },
    {
      "name": "withdrawSeller",
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
                "account": "listing"
              },
              {
                "kind": "account",
                "path": "listing.slugHash",
                "account": "listing"
              }
            ]
          }
        },
        {
          "name": "seller",
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
          "name": "sellerAta",
          "writable": true
        },
        {
          "name": "treasuryAta",
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
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "authorityTransfer",
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
      "name": "config",
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
      "name": "disputeRecord",
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
      "name": "listing",
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
      "name": "proofRecord",
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
      "name": "reviewAuthority",
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
      "name": "spot",
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
      "name": "bidPlaced",
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
      "name": "bidRefunded",
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
      "name": "configAuthorityAccepted",
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
      "name": "configAuthorityCancelled",
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
      "name": "configAuthorityProposed",
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
      "name": "configInitialized",
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
      "name": "configUpdated",
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
      "name": "deadlineExtended",
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
      "name": "disputeRaised",
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
      "name": "disputeResolved",
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
      "name": "disputeTimedOut",
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
      "name": "disputeTimeoutUpdated",
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
      "name": "disputeWithdrawn",
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
      "name": "listingClosed",
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
      "name": "listingCreated",
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
      "name": "proofSubmitted",
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
      "name": "reviewAuthorityInitialized",
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
      "name": "reviewAuthorityUpdated",
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
      "name": "sellerWithdrawn",
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
      "name": "spotAdded",
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
      "name": "spotClaimed",
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
      "name": "spotClosed",
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
      "name": "spotRefunded",
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
      "name": "invalidMode",
      "msg": "Unknown pricing mode. Use 0 for fixed-price, 1 for auction."
    },
    {
      "code": 6001,
      "name": "invalidDeadline",
      "msg": "Deadline must be in the future."
    },
    {
      "code": 6002,
      "name": "invalidArtworkClose",
      "msg": "Artwork close must not be before the deadline."
    },
    {
      "code": 6003,
      "name": "invalidDeliveryDeadline",
      "msg": "Delivery deadline must be after artwork close."
    },
    {
      "code": 6004,
      "name": "invalidReviewWindow",
      "msg": "Review window is outside the allowed range."
    },
    {
      "code": 6005,
      "name": "invalidMinIncrement",
      "msg": "Auction without double-up needs a minimum increment above zero."
    },
    {
      "code": 6006,
      "name": "metadataUriTooLong",
      "msg": "Metadata URI is too long."
    },
    {
      "code": 6007,
      "name": "invalidMint",
      "msg": "Mint is not a known USDC mint (devnet or mainnet-beta)."
    },
    {
      "code": 6008,
      "name": "invalidFeeBps",
      "msg": "Fee must be at most 10,000 basis points."
    },
    {
      "code": 6009,
      "name": "listingClosed",
      "msg": "Listing is past its deadline."
    },
    {
      "code": 6010,
      "name": "listingNotOpen",
      "msg": "Listing is not open."
    },
    {
      "code": 6011,
      "name": "spotNotOpen",
      "msg": "Spot is not open for claims or bids."
    },
    {
      "code": 6012,
      "name": "spotAlreadyFunded",
      "msg": "Spot was already paid. Seller withdraw or cancel only."
    },
    {
      "code": 6013,
      "name": "wrongMode",
      "msg": "This instruction does not match the listing pricing mode."
    },
    {
      "code": 6014,
      "name": "zeroPrice",
      "msg": "Spot price must be above zero."
    },
    {
      "code": 6015,
      "name": "tooManySpots",
      "msg": "Listing already has the maximum of 60 spots."
    },
    {
      "code": 6016,
      "name": "firstBidTooLow",
      "msg": "First bid must meet the starting price."
    },
    {
      "code": 6017,
      "name": "bidTooLow",
      "msg": "Bid must beat the current bid by the minimum increment."
    },
    {
      "code": 6018,
      "name": "bidMustDouble",
      "msg": "Takeover bid must be at least double the current bid."
    },
    {
      "code": 6019,
      "name": "withdrawTooEarly",
      "msg": "Settlement is only available after the deadline."
    },
    {
      "code": 6020,
      "name": "spotNotFunded",
      "msg": "Spot has no funds to withdraw."
    },
    {
      "code": 6021,
      "name": "vaultNotEmpty",
      "msg": "Vault still holds funds. Only unfunded spots can be closed."
    },
    {
      "code": 6022,
      "name": "unauthorized",
      "msg": "Only the seller can perform this action."
    },
    {
      "code": 6023,
      "name": "missingRefundAccount",
      "msg": "Previous bidder token account is required to refund an outbid."
    },
    {
      "code": 6024,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow."
    },
    {
      "code": 6025,
      "name": "proofRequired",
      "msg": "Proof is required before settlement."
    },
    {
      "code": 6026,
      "name": "proofAlreadySubmitted",
      "msg": "Proof was already submitted."
    },
    {
      "code": 6027,
      "name": "invalidProof",
      "msg": "Proof hash cannot be empty."
    },
    {
      "code": 6028,
      "name": "reviewWindowOpen",
      "msg": "Buyer review period is still open."
    },
    {
      "code": 6029,
      "name": "reviewWindowClosed",
      "msg": "Buyer review period has ended."
    },
    {
      "code": 6030,
      "name": "notWinningBuyer",
      "msg": "Only the winning buyer can dispute this spot."
    },
    {
      "code": 6031,
      "name": "proofDeadlinePassed",
      "msg": "Delivery deadline has passed; proof can no longer be submitted."
    },
    {
      "code": 6032,
      "name": "deliveryDeadlinePending",
      "msg": "Delivery deadline has not passed yet."
    },
    {
      "code": 6033,
      "name": "proofExists",
      "msg": "Proof exists; refund requires dispute resolution or seller cancellation."
    },
    {
      "code": 6034,
      "name": "invalidProofUri",
      "msg": "Proof URI must be nonempty and at most 200 bytes."
    },
    {
      "code": 6035,
      "name": "invalidDisputeEvidence",
      "msg": "Dispute evidence hash and URI must both be present or both absent, and URI at most 200 bytes."
    },
    {
      "code": 6036,
      "name": "invalidDecisionEvidence",
      "msg": "Decision hash and URI must be present, and URI at most 200 bytes."
    },
    {
      "code": 6037,
      "name": "invalidAuthorityTransfer",
      "msg": "Proposed authority must be a different, nondefault address."
    },
    {
      "code": 6038,
      "name": "invalidConfigAuthority",
      "msg": "Only the program upgrade authority can initialize config."
    },
    {
      "code": 6039,
      "name": "invalidReviewAuthority",
      "msg": "Only the configured review authority can approve a listing."
    },
    {
      "code": 6040,
      "name": "invalidFeePolicy",
      "msg": "Listing fee policy is invalid for its pricing mode."
    },
    {
      "code": 6041,
      "name": "listingHasActiveSpots",
      "msg": "Listing still has active spots."
    },
    {
      "code": 6042,
      "name": "listingStillActive",
      "msg": "Listing deadline has not passed yet."
    },
    {
      "code": 6043,
      "name": "protocolPaused",
      "msg": "Protocol is paused."
    },
    {
      "code": 6044,
      "name": "selfDealing",
      "msg": "Seller cannot buy or bid on their own listing."
    },
    {
      "code": 6045,
      "name": "disputeNotTimedOut",
      "msg": "Dispute has not timed out yet."
    },
    {
      "code": 6046,
      "name": "invalidDisputeTimeout",
      "msg": "Dispute timeout is outside the allowed range."
    }
  ],
  "types": [
    {
      "name": "authorityTransfer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "currentAuthority",
            "type": "pubkey"
          },
          {
            "name": "proposedAuthority",
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
      "name": "bidPlaced",
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
      "name": "bidRefunded",
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
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
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
            "name": "disputeTimeoutSeconds",
            "docs": [
              "Appended last; how long an unresolved dispute stays open before the buyer can be refunded."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "configAuthorityAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "configAuthorityCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "proposedAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "configAuthorityProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "currentAuthority",
            "type": "pubkey"
          },
          {
            "name": "proposedAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "deadlineExtended",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "previousDeadline",
            "type": "i64"
          },
          {
            "name": "newDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "disputeRaised",
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
            "name": "proofSubmitted",
            "type": "bool"
          },
          {
            "name": "evidenceHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "raisedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "disputeRecord",
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
            "name": "proofSubmitted",
            "type": "bool"
          },
          {
            "name": "evidenceHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "evidenceUri",
            "type": "string"
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "decisionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "decisionUri",
            "type": "string"
          },
          {
            "name": "decidedAt",
            "type": "i64"
          },
          {
            "name": "sellerShareBps",
            "type": "u16"
          },
          {
            "name": "buyerRefund",
            "type": "u64"
          },
          {
            "name": "sellerAmount",
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
      "name": "disputeResolved",
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
            "name": "decisionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sellerShareBps",
            "type": "u16"
          },
          {
            "name": "buyerRefund",
            "type": "u64"
          },
          {
            "name": "sellerAmount",
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
      "name": "disputeTimedOut",
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
      "name": "disputeTimeoutUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousSeconds",
            "type": "i64"
          },
          {
            "name": "newSeconds",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "disputeWithdrawn",
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
      "name": "listing",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "slugHash",
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
            "name": "metadataUri",
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
            "name": "artworkClose",
            "type": "i64"
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          },
          {
            "name": "reviewWindowSeconds",
            "type": "i64"
          },
          {
            "name": "minIncrement",
            "type": "u64"
          },
          {
            "name": "doubleUp",
            "type": "bool"
          },
          {
            "name": "spotCount",
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
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "upliftFeeBps",
            "type": "u16"
          },
          {
            "name": "maxFeeBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "listingClosed",
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
      "name": "listingCreated",
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
            "name": "slugHash",
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
            "name": "reviewWindowSeconds",
            "type": "i64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "upliftFeeBps",
            "type": "u16"
          },
          {
            "name": "maxFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "proofRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "spot",
            "type": "pubkey"
          },
          {
            "name": "proofHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proofUri",
            "type": "string"
          },
          {
            "name": "submittedAt",
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
      "name": "proofSubmitted",
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
            "name": "proofHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "submittedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "reviewAuthority",
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
      "name": "reviewAuthorityInitialized",
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
      "name": "reviewAuthorityUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "sellerWithdrawn",
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
      "name": "spot",
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
            "name": "currentBid",
            "type": "u64"
          },
          {
            "name": "currentBidder",
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
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "proofHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proofSubmittedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "spotAdded",
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
      "name": "spotClaimed",
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
      "name": "spotClosed",
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
      "name": "spotRefunded",
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
            "name": "sellerInitiated",
            "type": "bool"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "authorityTransferSeed",
      "type": "bytes",
      "value": "[97, 117, 116, 104, 111, 114, 105, 116, 121, 95, 116, 114, 97, 110, 115, 102, 101, 114]"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "defaultDisputeTimeoutSeconds",
      "type": "i64",
      "value": "259200"
    },
    {
      "name": "defaultReviewWindowSeconds",
      "type": "i64",
      "value": "172800"
    },
    {
      "name": "disputeSeed",
      "type": "bytes",
      "value": "[100, 105, 115, 112, 117, 116, 101]"
    },
    {
      "name": "listingClosed",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "listingOpen",
      "type": "u8",
      "value": "0"
    },
    {
      "name": "listingSeed",
      "type": "bytes",
      "value": "[108, 105, 115, 116, 105, 110, 103]"
    },
    {
      "name": "maxDisputeTimeoutSeconds",
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "maxReviewWindowSeconds",
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "maxSpotsPerListing",
      "type": "u8",
      "value": "60"
    },
    {
      "name": "minDisputeTimeoutSeconds",
      "type": "i64",
      "value": "3600"
    },
    {
      "name": "minReviewWindowSeconds",
      "type": "i64",
      "value": "3600"
    },
    {
      "name": "modeAuction",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "modeFixed",
      "type": "u8",
      "value": "0"
    },
    {
      "name": "proofSeed",
      "type": "bytes",
      "value": "[112, 114, 111, 111, 102]"
    },
    {
      "name": "reviewAuthoritySeed",
      "type": "bytes",
      "value": "[114, 101, 118, 105, 101, 119, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "snipeExtensionSeconds",
      "type": "i64",
      "value": "300"
    },
    {
      "name": "snipeWindowSeconds",
      "type": "i64",
      "value": "300"
    },
    {
      "name": "spotCancelled",
      "type": "u8",
      "value": "3"
    },
    {
      "name": "spotDisputed",
      "type": "u8",
      "value": "4"
    },
    {
      "name": "spotFinalized",
      "type": "u8",
      "value": "2"
    },
    {
      "name": "spotFunded",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "spotOpen",
      "type": "u8",
      "value": "0"
    },
    {
      "name": "spotSeed",
      "type": "bytes",
      "value": "[115, 112, 111, 116]"
    },
    {
      "name": "usdcMintDevnet",
      "type": "string",
      "value": "\"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU\""
    },
    {
      "name": "usdcMintMainnet",
      "type": "string",
      "value": "\"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\""
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
