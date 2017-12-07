'use strict';
let config = require('./config');
let fs = require('fs');
let path = require('path');
let archiver = require('archiver');
let mime = require('mime-types');


/**
 * Push an object to s3.
 * @param params AWS upload params
 * @returns {Promise}
 */
function putS3Object(params) {
  return new Promise((resolve, reject) => {
    let s3 = new config.AWS.S3({params: params});
    s3.upload({Body: params.Body}, function(err, data) {
      if (err) {
        reject(err);
      } else {
        config.logger.info('Successfully uploaded to s3://', params.Bucket + '/' + params.Key);
        resolve(data);
      }
    });
  });
}


/**
 * List the objects in the given bucket (up to 1000 items)
 * @param bucketName name of the bucket
 * @param continuationToken continue listing from this marker
 * @returns {Promise}
 */
function listObjects(bucketName, continuationToken) {
  return new Promise((resolve, reject) => {
    let s3 = new config.AWS.S3();
    let params = {
      Bucket: bucketName,
      ContinuationToken: continuationToken
    };
    s3.listObjectsV2(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * List versions for the given object (up to 1000 versions)
 * @param bucketName name of the bucket
 * @param key object key
 * @param continuationToken continute listing from this marker
 * @returns {Promise}
 */
function listObjectVersions(bucketName, key, continuationToken) {
  return new Promise((resolve, reject) => {
    let s3 = new config.AWS.S3();
    let params = {
      Bucket: bucketName,
      Prefix: key,
      MaxKeys: 1,
      VersionIdMarker: continuationToken
    };
    s3.listObjectVersions(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * Delete the specified items
 * @param bucketName the name of the bucket
 * @param objectKeys listing of object keys to delete
 * @returns {Promise}
 */
function deleteObjects(bucketName, objectKeys) {
  return new Promise((resolve, reject) => {
    let s3 = new config.AWS.S3();
    let params = {
      Bucket: bucketName,
      Delete: { Objects: objectKeys }
    };
    s3.deleteObjects(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * Delete the specified versioned items
 * @param bucketName the name of the bucket
 * @param objectKeys listing of the object keys to delete
 * @returns {Promise}
 */
function deleteVersionedObjects(bucketName, objectKeys) {
  return new Promise((resolve, reject) => {
    let listAndDelete = function(key, continuationToken) {
      return new Promise((resolve, reject) => {
        listObjectVersions(bucketName, key, continuationToken)
          .then(data => {
            if (data && data.Versions && data.Versions.length > 0) {
              let keys = data.Versions.map((version) => ({Key: version.Key, VersionId: version.VersionId}));
              deleteObjects(bucketName, keys)
                .then(() => resolve(data.NextVersionIdMarker ));
            } else {
              resolve();
            }
          }).catch(err => reject(err));
      });
    };

    Promise.all(objectKeys.map((key) => new Promise((resolve, reject) => {
      listAndDelete(key)
        .then(continuationToken => {
          if (continuationToken) {
            return(listAndDelete(key, continuationToken))
          }
        })
        .then(() => resolve())
        .catch(err => reject(err));
      })))
      .then(() => resolve())
      .catch(err => reject(err));
  });
}


/**
 * Empty the specified bucket (including all versioned items)
 * @param bucketName the name of the bucket
 * @returns {Promise}
 */
function emptyBucket(bucketName) {
  return new Promise((resolve, reject) => {
    let versioningEnabled = false;
    let s3 = new config.AWS.S3();
    let params = {
      Bucket: bucketName
    };

    let listAndDelete = function(continuationToken) {
      return new Promise((resolve, reject) => {
        listObjects(bucketName, continuationToken)
          .then(data => {
            if (data && data.Contents && data.Contents.length > 0) {
              let keys = data.Contents.map((object) => ({Key: object.Key}));
              (versioningEnabled ?
                deleteVersionedObjects(bucketName, keys) :
                deleteObjects(bucketName, keys))
                .then(() => resolve(data.NextContinuationToken));
            } else {
              resolve();
            }
          }).catch(err => reject(err));
      });
    };

    s3.getBucketVersioning(params, (err, data) => {
      if (err) {
        if (err.toString().indexOf('The specified bucket does not exist') >= 0) {
          config.logger.info('Bucket', bucketName, 'does not exist, continuing...');
          resolve();
        } else {
          reject(err);
        }
      } else {
        versioningEnabled = data.Status === 'Enabled';

        listAndDelete()
          .then(continuationToken => {
            if (continuationToken) {
              return(listAndDelete(continuationToken))
            }
          })
          .then(() => resolve())
          .catch(err => reject(err));
      }
    });
  });
}


/**
 * Upload a directory (including all subdirectories) to an S3 bucket.
 * @param bucketName the name of the bucket
 * @param prefix [optional] folder/prefix to upload content to
 * @param source fully qualified path of the source directory
 * @returns {Promise}
 */
function uploadDirectory(bucketName, prefix, source) {
  if (!source) { source = prefix; prefix = null; }
  
  return new Promise((resolve, reject) => {
    let s3 = new config.AWS.S3();

    fs.readdir(source, (err, files) => {
      if (err) {
        reject(err);
      } else {
        if (!files || files.length === 0) {
          reject(new Error(`Folder \'${source}\' is empty or does not exist. Did you forget to build your application?`))
        } else {
          let uploadFile = function (name, filePath) {
            let key = (prefix ? prefix + '/' : '') + name;
            return new Promise((resolve, reject) => {
              s3.putObject({
                Bucket: bucketName,
                Key: key,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(name) || 'application/octet-stream'
              }, (err) => {
                if (err) {
                  reject(err);
                } else {
                  config.logger.info('Successfully uploaded to s3://', bucketName + '/' + key);
                  resolve();
                }
              });
            });
          };

          let operations = [];
          for (const fileName of files) {
            const filePath = path.join(source, fileName);
            if (fs.lstatSync(filePath).isDirectory()) {
              operations.push(uploadDirectory(bucketName, (prefix ? prefix + '/' : '') + fileName, filePath));
            } else {
              operations.push(uploadFile(fileName, filePath));
            }
          }

          Promise.all(operations)
            .then(() => resolve())
            .catch(err => reject(err));
        }
      }
    });
  });
}

/**
 * Upload the directory as a zip file to s3.
 * @param bucketName the name of the bucket
 * @param key s3 target key
 * @param source source directory
 * @param dest destination directory for zip file
 * @param name name of the zip file
 * @returns {Promise}
 */
function uploadDirectoryAsZipFile(bucketName, key, source, dest, name) {
  return new Promise((resolve, reject) => {

    // Create dest directory if it does not exist
    dest.split(dest.includes(path.sep) ? path.sep : '/').reduce((parent, child) => {
      const curr = path.resolve(parent, child);
      if (!fs.existsSync(curr)) {
        fs.mkdirSync(curr);
        config.logger.info("Created directory: " + curr);
      }
      return curr;
    }, path.isAbsolute(dest) ? path.sep : '');


    let fullPath = path.join(dest, name);
    let output   = fs.createWriteStream(fullPath);
    let archive  = archiver.create('zip');

    output.on('close', function () {
      config.logger.info('Zip archive written to ' + name + ' as ' + archive.pointer() + ' total bytes compressed');

      config.logger.info('Uploading ...');
      let s3 = new config.AWS.S3({params: {Bucket: bucketName, Key: key}});
      let stream = fs.createReadStream(fullPath);
      s3.putObject({Body: stream}, function(err) {
        if (err) {
          reject(err);
        } else {
          process.stdout.write('\n');
          config.logger.info('Successfully uploaded to s3://', bucketName + '/' + key);
          resolve(fullPath);
        }
      })
      .on('httpUploadProgress', (progress, response) => {
        process.stdout.write('.');
      });
    });

    archive.on('error', function(err){
      reject(err);
    });

    archive.pipe(output);
    archive.directory(source, '/');
    archive.finalize();
  });
}



module.exports = {
  putS3Object,
  listObjects,
  listObjectVersions,
  deleteObjects,
  deleteVersionedObjects,
  emptyBucket,
  uploadDirectory,
  uploadDirectoryAsZipFile
};
