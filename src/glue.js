'use strict';
let config = require('./config');


/**
 * Create a series of label/year/month/day/hour partitions
 * @param {String} database database name
 * @param {String} table table name
 * @param {String} label partition label
 * @param {Date} start start date
 * @param {Number} days number of days to create partitions
 * @param {String} format partition format (Hive or default firehose format)
 * @param {String} catalogId [optional] catalog id
 */
function createPartitions(database, table, label, start, days, format, catalogId){
  let add = (d, c) => { let n=new Date(d); n.setDate(n.getDate()+c);return n; }
  let pad = (n) => n.toString().padStart(2, '0');
  let cut = (a, l) => {var c=[],i=0,n=a.length; while(i<n){c.push(a.slice(i,i+=l));}return c;}

  let glue = new config.AWS.Glue();
  let now = new Date();
  start = start > now ? now : start;
  let end = add(start, days);

  return glue.getTable({DatabaseName: database, Name: table, CatalogId: catalogId})
  .promise()
  .then(info => {
    let partitions = [];
    for(var date = start; date <= end; date = new Date(date.getTime()+36e5)) {
      let year  = date.getFullYear().toString(),
          month = pad(date.getMonth()+1),
          day   = pad(date.getDate()),
          hour  = pad(date.getHours());
      partitions.push({
        Values: [label, year, month, day, hour],
        StorageDescriptor: {
          Location:     (format === 'Hive') ?
                          info.Table.StorageDescriptor.Location+'/tenant='+label+'/'+'year='+year+'/'+'month='+month+'/'+'day='+day+'/'+'hour='+hour+'/' :
                          info.Table.StorageDescriptor.Location+label+'/'+year+'/'+month+'/'+day+'/'+hour,
          InputFormat:  info.Table.StorageDescriptor.InputFormat,
          OutputFormat: info.Table.StorageDescriptor.OutputFormat,
          SerdeInfo:    info.Table.StorageDescriptor.SerdeInfo,
          Parameters:   info.Table.StorageDescriptor.Parameters,
          Columns:      info.Table.StorageDescriptor.Columns
        }
      });
    }

    return Promise.all(cut(partitions, 100).map(list => {
      return glue.batchCreatePartition({ // batchCreatePartition has limit of 100 partitions in a single api call
        CatalogId: catalogId, DatabaseName: database, TableName: table, PartitionInputList: list
      })
      .promise()
      .then(result =>
        (result.Errors || [])
        .find(e => e && e.ErrorDetail && e.ErrorDetail.ErrorCode && e.ErrorDetail.ErrorCode !== 'AlreadyExistsException') ?
          Promise.reject(e) : Promise.resolve(result)
      );
    }));
  })
}


module.exports = {
  createPartitions
};
