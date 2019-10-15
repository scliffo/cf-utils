'use strict';
let config = require('./config');

/**
 * Create a parquet conversion step for the specified firehose stream
 * @param {String} deliveryStreamName firehose delivery stream
 * @param {*} databaseName glue database name
 * @param {*} tableName table to store conversion output
 */
function createParquetConversion(deliveryStreamName, databaseName, tableName) {
  let firehose = new config.AWS.Firehose();
  return firehose.describeDeliveryStream({DeliveryStreamName: deliveryStreamName})
  .promise()
  .then(stream => {
    let s3dest = stream.DeliveryStreamDescription.Destinations[0]['ExtendedS3DestinationDescription'];

    s3dest.DataFormatConversionConfiguration = {
      SchemaConfiguration: {
        RoleARN: "",
        DatabaseName: databaseName,
        TableName: tableName,
        Region: config.awsRegion,
        VersionId: "LATEST"
      },
      InputFormatConfiguration: {Deserializer: {OpenXJsonSerDe: {}}},
      OutputFormatConfiguration: {Serializer: {ParquetSerDe: {}}},
      Enabled: true
    };
    s3dest.DataFormatConversionConfiguration.SchemaConfiguration.RoleARN = s3dest.RoleARN;
    s3dest.CompressionFormat = "UNCOMPRESSED";
    s3dest.BufferingHints = {SizeInMBs:64,IntervalInSeconds:60};

    const params = {
      ExtendedS3DestinationUpdate:    s3dest,
      CurrentDeliveryStreamVersionId: stream.DeliveryStreamDescription.VersionId,
      DestinationId:                  stream.DeliveryStreamDescription.Destinations[0].DestinationId,
      DeliveryStreamName:             stream.DeliveryStreamDescription.DeliveryStreamName
    };
    config.logger.info("Updating firehose with parquet conversion:", params.DeliveryStreamName );
    return firehose.updateDestination(params).promise()
  });
}

/**
 * Tag the specified firehose stream
 * @param {String} firehose kinesis firehose stream
 */
function tagFirehoseStream (firehose, tags) {
  const fh = new config.AWS.Firehose({apiVersion: '2015-08-14'});
  let defaultTags = [
    {
      Key: 'acs:project',
      Value: config.project
    },
    {
      Key: 'acs:project-version',
      Value: config.projectVersion
    }
  ];
  return fh.tagDeliveryStream({DeliveryStreamName: firehose, Tags: tags ? tags : defaultTags}).promise();
}

/**
 * Launch the specifed kinesis application.
 * @param {String} application kinesis application
 */
function startApplication (application) {
  const kinesis = new config.AWS.KinesisAnalytics({apiVersion: '2015-08-14'});
  return kinesis.describeApplication({ApplicationName: application})
  .promise()
  .then(appInfo => {
    config.logger.info('Starting kinesis application:', application, '...');
    return kinesis.startApplication({
      ApplicationName: application,
      InputConfigurations: [{
        Id: appInfo.InputDescriptions[0].Id,
        InputStartingPositionConfiguration: {InputStartingPosition: 'NOW'}
      }]
    }).promise();
  });
}


module.exports = {
  createParquetConversion,
  tagFirehoseStream,
  startApplication
};
