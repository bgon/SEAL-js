/************************************************
 SEAL: implemented in Typescript
 Original C code Copyright (c) 2024 Hacker Factor, Dr. Neal Krawetz
 Ported to TypeScript by Bertrand Gondouin (c) 2024
 See LICENSE & LICENSE-typescript
 ************************************************/

import { MediaAsset } from './mediaasset';
import { DoH } from './doh';
import { Crypto } from './crypto';
import { base64ToUint8Array, hexToUint8Array, mergeBuffer, createDate } from './utils';

interface sealValidation {
  digest_ranges?: any[];
  digest_summary: string;
  error?: any[];
  digest1?: Uint8Array;
  digest2?: Uint8Array;
  signature_date?: string;
  signature?: string;
  signature_bytes: Uint8Array;
  signature_encoding: string;
  verbose: boolean;
  doh_api: string;
}

interface sealAttributes {
  /**
   * This specifies a SEAL record version.
   * - This MUST be the first text in the TXT record.
   */
  seal: string; // 'seal_version',

  /**
   * The domain name containing the DNS TXT record for the SEAL public key.
   */
  d: string;

  /**
   * The asset's key algorithm.
   * - This must match the algorithm used to generate the key.
   * - For now, you can expect "rsa". For elliptic curve algorithms, use "ec".
   */
  ka: string;

  /**
   * This specifies the key version, in case you update the keys.
   * - When not specified, the default value is "1".
   * - The value can be any text string using the character set: `[A-Za-z0-9.+/-]` (letters, numbers, and limited punctuation; no spaces).
   */
  kv?: string;

  /**
   * The computed signature for the SEAL record.
   * - This MUST be last value in the SEAL record.
   * - If in binary format, the signature must not be quoted.
   * - If in base64 or hexadecimal format, the signature may be padded with spaces.
   */
  s: string;

  /**
           * The signature format. Possible values:
              - "hex": The signature is stored as a two-byte hexadecimal notation using lowercase letters [0-9a-f].
                  - Optional padding can use spaces (character 0x20) after the hexadecimal value.
              - "HEX": The signature is stored as a two-byte hexadecimal notation using uppercase letters [0-9A-F].
                  - Optional padding can use spaces (character 0x20) after the hexadecimal value.
              - "base64": The signature is stored as a base64-encoded value.
                  - Terminating "=" padding may be omitted.
                  - Optional padding can use spaces (character 0x20) after the base64 value. `base64` is the default encoding method if `sf=` is not specified.
              - "bin": The signature is stored as a raw binary data.
                  - This should only be used in file formats that support storing binary data. (This is also why the signature must always be the last element in the SEAL record. The binary signature ends when the SEAL record ends. Alternately, the `sl=` parameter can be used to specify the signature length.)
              - "date:" Any of the other formats may be preceded by the literal `date:`, such as `sf=date:hex`.
                  - This indicates that the signature begins with a timestamp in GMT YYYYMMDDhhmmss.
                  - The date is generated by the signer.
              - "date[0-9]:" Date with a number indicates the number of decimal points in the fraction of the date. This is used to specify subseconds.
                  - The number of decimal points identifies the accuracy of the timestamp. For example:
                      - date: may generate "20240326164401:" for 2024-03-26 16:44:01 GMT. The accuracy is +/- 0.5 seconds.
                      - date0: specifies no fractions and is the same as date.
                      - date1: specifies one decimal point, such as "20240326164401.5" and accuracy to within 0.05 seconds.
                      - date2: specifies one decimal point, such as "20240326164401.50" and accuracy to within 0.005 seconds.
                      - date3: specifies one decimal point, such as "20240326164401.500" and accuracy to within 0.0005 seconds.
           */
  sf?: string;

  /**
   * The digest algorithm.
   *  - This MUST be a NIST-approved algorithm. Current supported values are:
   *      - "sha256": The default value.
   *      - "sha512": For much longer digests.
   *      - "sha1": For shorter digests. (This algorithm is deprecated by NIST, but still widely used.)
   */
  da: string; //'digest_algorithm', The digest algorithm. This MUST be a NIST-approved algorithm.

  /**
   * The byte range to include in the digest.
   *  - This can be a complex field with sets of ranges *start*~*stop*, using tilda to denote the range deliminator.
   *  - Multiple ranges may be specified by commas.
   *  - Any literal character may be combined with simple arithmetic offsets.
   *  - For example: `b=F+4~S,s~f-20` This defines two ranges. The first begins 4 bytes into the file and ends at the start of the signature. The second begins after the signature and ends 20 bytes before the end of the file.
   */
  b?: string; // 'byte_range', The byte range to include in the digest

  /**
   * This specifies an optional unique identifier, such as a UUID or date.
   *  - The value is case-sensitive.
   *  - The uid permits different users at a domain to have many different keys.
   *  - The default value is an empty string: `uid=""`.
   */
  uid?: string; // 'unique_identifier', This specifies an optional unique identifier, such as a UUID or date. The value is case-sensitive.When not present, the default value is an empty string: uid=''.

  /**
   * A unique identifier identifying the signer's account or identity at the signing domain. When present, this impacts the signature generation.
   */
  id?: string; // 'identifier', A unique identifier identifying the signer's account or identity at the signing domain

  /**
   * Textual comment information.
   *  - Typically this is stored in another metadata field, such as EXIF, IPTC, or XMP. However, it can be included in the SEAL record.
   */
  info?: string; // 'seal_comment', Textual comment information.

  /**
   * Copyright information.
   *  - Copyright information is typically stored in another metadata field, such as EXIF, IPTC, or XMP. However, it can be included in the SEAL record.
   */
  copyright?: string;

  /**
   * The timestamp in [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) (year-month-day) format denoting the revocation date in GMT.
   *  - All signatures after this date are treated as invalid, even if the public key validates the signature.
   *  - Use this when the key is revoked after a specific date. E.g.:
   *      - `r=2024-04-03T12:34:56`
   *      - `r="2024-04-03 12:34:56"`
   *      - `r=2024-04-03`.
   */
  r?: Date;

  /**
   * The base64-encoded public key.
   *  - Ending "=" in the base64 encoding may be omitted.
   *  - The value may include whitespace and double quotes. For example:
   *      - `p="abcdefg="` is the same as `p=abcdefg` is the same as `p="abc" "defg" "="`.
   *  - Double quotes and spaces are permitted because some DNS systems require breaks for long values.
   *  - The `p=` parameter MUST be the last field in the DNS TXT record.
   */
  p: string;

  /**
   * The signature length is typically optional.
   *  - The current supported algorithm (`ka=rsa`) does not require padding and uses a fixed-length, so `sl=` is unnecessary.
   *  - It is only required if:
   *      - padding is applied, If the signature contains any padding characters, then this field MUST be included to prevent tampering with the padding.
   *      - the length of a signature is variable
   *      - the length cannot be determined based on the SEAL record data storage.
   *  - The length MUST include whatever padding is required for storing the computed signature.
   *  - The signature algorithm (`ka=`) MUST know how to identify and handle padding.
   */
  sl?: string;
}

type ErrorName =
  | 'DNS_LOOKUP'
  | 'SEAL_RECORD_MISSING_PARAMETERS'
  | 'KEY_IMPORT_ERROR'
  | 'DIGEST_MISSING'
  | 'DIGEST_ERROR'
  | 'VALIDATION_MISSING_PARAMETERS'
  | 'SIGNATURE_VERIFY_ERROR'
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_FORMAT';

// Extend the built-in Error class to create a custom ValidationError class
export class ValidationError extends Error {
  name: ErrorName; // Specific type for error name
  cause?: any; // Optional cause of the error

  /**
   * Constructor to initialize ValidationError instance
   * @param name - The name of the error
   * @param message - The error message
   * @param cause - (Optional) The underlying cause of the error
   */
  constructor({ name, message, cause }: { name: ErrorName; message: string; cause?: any }) {
    super(message); // Call the parent class constructor with the message
    this.name = name;
    this.cause = cause;
  }
}
export class SEAL {
  public static public_keys: any = {};
  public static seals: any = [];
  public static record: sealAttributes;
  public static validation: sealValidation;

  /**
   * Parses the SEAL segment string in the asset and extracts parameters.
   *
   * @param asset - The asset object containing SEAL segments.
   */
  public static parse(asset: any) {
    // Start timing the parse operation
    console.time('parse');

    // Clean the SEAL segment string by removing tag characters
    // - Text: <seal ... />
    // - XML/SVG/HTML: <?seal ... ?>
    // - XMP: <*:seal>&lt;seal ... /&gt;</\*:seal>, <*:seal seal='&lt;seal .../&gt;' /> Where '*' is a namespace

    //take into account XML and HTML character entities with padding for &quot;
    if (asset.seal_segments[0].string.match(/&quot;/g)) {
      asset.seal_segments[0].signature_end = asset.seal_segments[0].signature_end - 5;
    }

    const sealSegmentString = asset.seal_segments[0].string
      .replace(/<.{0,1}seal /, '')
      .replace(/\?{0,1}\/>/, '')
      .replace(/&quot;/g, '"')
      .replace('<seal:seal>', '')
      .replace('/&', '')
      .replace('&lt;seal ', '');

    // Initialize the SEAL record object
    const sealRecord: any = {};

    // Regex pattern to match parameter key-value pairs
    const parameterPattern = / ?(.*?)=\"(.*?)\"/gm;
    let match: RegExpExecArray | null;

    // Extract parameters using the regex pattern
    while ((match = parameterPattern.exec(sealSegmentString)) !== null) {
      // Prevent infinite loops with the regex
      if (match.index === parameterPattern.lastIndex) {
        parameterPattern.lastIndex++;
      }
      // Map the parameter key-value pairs to the SEAL record object
      sealRecord[match[1]] = match[2];
    }

    if (!sealRecord.da) {
      sealRecord.da = 'sha256';
    }

    switch (sealRecord.da) {
      case 'sha256':
        sealRecord.da = 'SHA-256'; // 32 bytes
        break;
      case 'sha384':
        sealRecord.da = 'SHA-384'; // 48 bytes
        break;
      case 'sha512':
        sealRecord.da = 'SHA-512'; // 64 bytes
        break;
      case 'sha1':
        sealRecord.da = 'SHA-1'; // 20 bytes (This algorithm is deprecated by NIST, but still widely used, but don't use this in cryptographic applications)
        break;
      default:
        sealRecord.da = 'SHA-256';
        break;
    }

    // Validate that all required parameters are present
    if (sealRecord.seal && sealRecord.d && sealRecord.ka && sealRecord.s) {
      this.record = sealRecord;
    } else {
      throw new ValidationError({
        name: 'SEAL_RECORD_MISSING_PARAMETERS',
        message: 'The SEAL record is incomplete',
      });
    }

    // End timing the parse operation
    console.timeEnd('parse');
  }

  /**
   * Validates the digital signature of the given asset using the SEAL protocol.
   *
   * @param {any} asset - The asset containing the data to validate.
   * @param {boolean} [verbose=false] - Whether to provide verbose output.
   * @returns {Promise<{ result: boolean, summary: string }>} - A promise that resolves to an object containing the validation result and summary.
   */
  public static async validateSig(asset: any, verbose: boolean = false): Promise<{ result: any }> {
    return new Promise(async (resolve, reject) => {

      let result_summary: any = {};
      asset = MediaAsset.readChunks(asset)

      if (!asset.seal_segments) {
        result_summary.message = "😢 No SEAL signatures found."
        return resolve(result_summary)
      }

      this.validation = {
        digest_summary: '',
        signature_bytes: new Uint8Array(),
        signature_encoding: '',
        verbose: verbose,
        doh_api: 'https://mozilla.cloudflare-dns.com/dns-query',
      };

      SEAL.parse(asset);

      // DNS lookup if not in cache
      let domain = this.record.d;
      if (!this.public_keys[domain]) {
        let TXTRecords = await DoH.getDNSTXTRecords(domain, this.validation.doh_api).catch((error) => {
          return reject(
            new ValidationError({
              name: 'DNS_LOOKUP',
              message: 'Querying DoH ' + this.record.d + ' DNS for a TXT record failed',
              cause: error.message,
            }),
          );
        });

        // Abort if no TXT record
        if (!TXTRecords) {
          return;
        }

        // Sort the keys based on the key algorithm
        TXTRecords.forEach((record: any) => {
          if (record.ka && record.seal && record.p) {
            if (!this.public_keys[domain]) {
              this.public_keys[domain] = {};
            }

            if (record.ka === 'rsa') {
              this.public_keys[domain].rsa = record.p;
            }

            if (record.ka === 'ec') {
              this.public_keys[domain].ec = record.p;
            }
          }
        });

        // Abort if no SEAL public key
        if (!this.public_keys[domain]) {
          return reject(
            new ValidationError({
              name: 'DNS_LOOKUP',
              message: 'Public key not found or corrupted',
              cause: JSON.stringify(TXTRecords),
            }),
          );
        }
      }

      await SEAL.digest(asset).catch((error) => {
        reject(
          new ValidationError({
            name: 'DIGEST_ERROR',
            message: 'Digest can not be processed',
            cause: error.message,
          }),
        );
      });
      await SEAL.doubleDigest().catch((error) => {
        reject(
          new ValidationError({
            name: 'DIGEST_ERROR',
            message: 'doubleDigest can not be processed',
            cause: error.message,
          }),
        );
      });

      let algorithmParameters = Crypto.getAlgorithmParameters(
        this.public_keys[this.record.d][this.record.ka],
        this.record.da,
        this.record.ka,
      );

      let cryptoKey = await Crypto.importCryptoKey(this.public_keys[this.record.d][this.record.ka], algorithmParameters).catch((error) => {
        reject(
          new ValidationError({
            name: 'KEY_IMPORT_ERROR',
            message: "crypto.subtle.importKey couldn't process the data",
            cause: error.message,
          }),
        );
      });

      if (this.validation.digest2 && this.validation.signature && cryptoKey) {
        console.time('verifySignature');

        let result = await Crypto.verifySignature(
          this.validation.digest2,
          this.validation.signature_bytes,
          cryptoKey,
          algorithmParameters,
        ).catch((error) => {
          return reject(
            new ValidationError({
              name: 'SIGNATURE_VERIFY_ERROR',
              message: 'The signature can not be verified',
              cause: error.message,
            }),
          );
        });
        console.timeEnd('verifySignature');



        if (result === true) {
          result_summary.message = `✅ SEAL record #1 is valid.`;
          result_summary.valid = true;
        } else {
          result_summary.message = `⛔ SEAL record #1 is NOT valid.`;
          result_summary.valid = false;
        }


        result_summary.filename = asset.name;
        result_summary.filemime = asset.mime;

        if (this.validation.verbose) {
          result_summary.filesize = asset.size - 1;
          result_summary.filedomain = asset.domain;
          result_summary.doh_api = this.validation.doh_api;
          result_summary.domain = this.record.d;

          // Signature date
          if (this.validation.signature_date) {
            result_summary.signed_on = createDate(this.validation.signature_date).toISOString();
          }

          // Digests
          result_summary.digest = Array.from(this.validation.digest1 as Uint8Array)
            .map((bytes) => bytes.toString(16).padStart(2, '0'))
            .join('');

          this.validation.digest2 = new Uint8Array(await crypto.subtle.digest(this.record.da, this.validation.digest2));
          result_summary.double_digest = Array.from(this.validation.digest2)
            .map((bytes) => bytes.toString(16).padStart(2, '0'))
            .join('');

          // Crypto
          result_summary.key_algorithm = `${this.record.ka.toUpperCase()}, ${Crypto.getCryptoKeyLength(cryptoKey)} bits`;
          result_summary.digest_algorithm = this.record.da;
          result_summary.key_base64 = this.public_keys[this.record.d][this.record.ka];

          // Ranges, format them for similar output as Sealtool
          let digest_ranges_summary: string[] = [];
          this.validation.digest_ranges?.forEach((digest_range) => {
            digest_ranges_summary.push(digest_range[0] + '-' + (digest_range[1] - 1));
          });
          result_summary.signed_bytes = digest_ranges_summary;
          result_summary.spans = this.validation.digest_summary;

          result_summary.user = this.record.id;
          if (this.record.copyright) {
            result_summary.copyright = this.record.copyright;
          }
          if (this.record.info) {
            result_summary.comment = this.record.info;
          }
        }
        resolve(result_summary);
      } else {
        reject(
          new ValidationError({
            name: 'VALIDATION_MISSING_PARAMETERS',
            message: 'Double Digest or Signature is missing',
          }),
        );
      }
    });
  }

  /**
   * digest(): Given a file, compute the digest!
   * Computes the digest and stores binary data in @digest1.
   * Stores the byte range in 'digest_range'.
   * Sets 'digest_summary' to store summaries of range
   * @private
   * @static
   * @memberof SEAL
   */
  private static async digest(asset: any): Promise<void> {
    return new Promise(async (resolve, reject) => {
      console.time('digest');
      // Digest ranges mapping
      this.validation.digest_ranges = [];

      let show_range_start: String;
      let show_range_stop: String;

      if (this.record.b) {
        let digest_ranges = this.record.b.split(',');
        digest_ranges.forEach((digest_range) => {
          let start;
          let stop;
          [start, stop] = digest_range.split('~');

          let sub: any = start.split('-');
          let add: any = start.split('+');

          if (sub[1]) {
            start = sub[0];
            sub = parseInt(sub[1]);
          } else {
            sub = 0;
          }

          if (add[1]) {
            start = add[0];
            add = parseInt(add[1]);
          } else {
            add = 0;
          }

          switch (start) {
            case 'F':
              start = 0;
              if (!show_range_start) {
                show_range_start = 'Start of file';
              }
              break;
            case 'f':
              start = asset.size;
              if (!show_range_start) {
                show_range_start = 'End of file';
              }
              break;
            case 'S':
              start = asset.seal_segments[0].signature_end - this.record.s.length;
              if (!show_range_start) {
                show_range_start = 'Start of signature';
              }
              break;
            case 's':
              start = asset.seal_segments[0].signature_end;
              if (!show_range_start) {
                show_range_start = 'End of signature';
              }
              break;
            case 'P':
              start = 0; // to do
              break;
            case 'p':
              start = 0; // to do
              break;
            default:
              return reject(new Error('ranges start error'));
          }
          start = start + add + sub;

          sub = stop.split('-');
          add = stop.split('+');

          if (sub[1]) {
            stop = sub[0];
            sub = parseInt(sub[1]);
          } else {
            sub = 0;
          }

          if (add[1]) {
            stop = add[0];
            add = parseInt(add[1]);
          } else {
            add = 0;
          }

          switch (stop) {
            case 'F':
              stop = 0;
              show_range_stop = 'Start of file';
              break;
            case 'f':
              stop = asset.size;
              show_range_stop = 'End of file';
              break;
            case 'S':
              stop = asset.seal_segments[0].signature_end - this.record.s.length;
              show_range_stop = 'start of signature';
              break;
            case 's':
              stop = asset.seal_segments[0].signature_end;
              show_range_stop = 'end of signature';
              break;
            case 'P':
              stop = 0; // to do
              break;
            case 'p':
              stop = 0; // to do
              break;
            default:
              return reject(new Error('ranges stop error'));
          }

          stop = stop + add + sub;
          this.validation.digest_ranges?.push([start, stop]);
          this.validation.digest_summary = `${show_range_start} to ${show_range_stop}`;
        });

        crypto.subtle
          .digest(this.record.da, MediaAsset.assembleBuffer(asset, this.validation.digest_ranges))
          .then((digest) => {
            this.validation.digest1 = new Uint8Array(digest);
            console.timeEnd('digest');
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      }
    });
  }

  /**
   * If there's a date or id (user_id), then add them to the digest.
   * This uses binary 'digest1', 'id', 'signature_date', and 'da'.
   * Computes the digest and places new data in digest2.
   *
   * @private
   * @static
   * @memberof SEAL
   */
  private static doubleDigest(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      console.time('doubleDigest');
      let signature_formats: string[] = [];

      if (this.record.sf) {
        signature_formats = this.record.sf.split(':');
      }

      if (this.record.s) {
        this.validation.signature = this.record.s;

        try {
          if (signature_formats.length > 0) {
            signature_formats.forEach((format: string) => {
              if (format == 'base64' || format == 'hex' || format == 'HEX' || format == 'bin') {
                this.validation.signature_encoding = format;
                if (this.validation.signature) this.validation.signature = this.validation.signature.replace(format + ':', '');
              }

              if (format.includes('date')) {
                let accuracy = parseInt(format.charAt(format.length - 1));
                if (isNaN(accuracy)) {
                  this.validation.signature = this.record.s.substring(15, this.record.s.length);
                  this.validation.signature_date = this.record.s.substring(0, 14);
                } else {
                  this.validation.signature = this.record.s.substring(16 + accuracy, this.record.s.length);
                  this.validation.signature_date = this.record.s.substring(0, 15 + accuracy);
                }
              }
            });
          } else {
            // Default
            this.validation.signature_encoding = 'base64';
          }
          if (this.validation.signature_encoding == 'hex' || this.validation.signature_encoding == 'HEX') {
            this.validation.signature_bytes = hexToUint8Array(this.validation.signature);
          }

          if (this.validation.signature_encoding == 'base64') {
            this.validation.signature_bytes = base64ToUint8Array(this.validation.signature);
          }
        } catch (error) {
          return reject(error);
        }
      } else {
        reject(
          new ValidationError({
            name: 'SIGNATURE_MISSING',
            message: 'The signature is missing',
          }),
        );
      }

      let prepend: string = '';

      if (this.validation.signature_date) {
        prepend = this.validation.signature_date + ':';
      }
      if (this.record.id) {
        prepend = prepend + this.record.id + ':';
      }
      const textEncoder = new TextEncoder();
      let prepend_buffer: Uint8Array = textEncoder.encode(prepend);

      if (this.validation.digest1) {
        //Note crypto.subtle.verify does the hashing!
        this.validation.digest2 = mergeBuffer(prepend_buffer, this.validation.digest1);

        console.timeEnd('doubleDigest');
        resolve();
      } else {
        reject(
          new ValidationError({
            name: 'DIGEST_MISSING',
            message: 'The digest is missing',
          }),
        );
      }
    });
  }
}
