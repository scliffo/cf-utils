'use strict';
let config = require('./config');
let s3 = require('./s3');


/**
 * Create a new key pair
 * @param name the name of the key pair
 * @param bucketName [optional] bucket to store keypair pem
 * @param key [optional] s3 target key for keypair pem
 * @return {Promise}
 */
function createKeyPair(name, bucketName, key) {
  return new Promise((resolve, reject) => {
    let ec2 = new config.AWS.EC2();
    ec2.createKeyPair({ KeyName: name}, (err, data) => {
      if (err) {
        if (err.toString().indexOf('already exists') >= 0) {
          config.logger.info('Key pair already exists, continuing...');
          resolve();
        } else {
          reject(err);
        }
      } else {
        config.logger.info('Successfully created new key pair: ' + name);
        if (bucketName) {
          resolve(s3.putS3Object({Bucket: bucketName, Key: key, Body: data.KeyMaterial}));
        } else {
          resolve(data);
        }
      }
    });
  });
}

/**
 * Delete the specified keypair
 * @param name the name of the key pair
 * @param bucketName [optional] bucket to delete keypair pem
 * @param key [optional] s3 target key for keypair pem
 * @return {Promise}
 */
function deleteKeyPair(name, bucketName, key) {
  return new Promise((resolve, reject) => {
    let ec2 = new config.AWS.EC2();
    ec2.deleteKeyPair({ KeyName: name}, (err, data) => {
      if (err) {
        reject(err);
      } else {
        config.logger.info('Successfully deleted key pair : ' + name);
        if (bucketName) {
          config.logger.info('Deleting pem file s3://:' + bucketName + '/' + key);
          resolve(s3.deleteObjects(bucketName, [{Key: key}]));
        } else {
          resolve(data);
        }
      }
    })
  });
}

module.exports = {
  createKeyPair,
  deleteKeyPair
};
