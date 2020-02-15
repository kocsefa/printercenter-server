const winston = require('winston')
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'user-service' },
  transports: [
    // new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
})
logger.info('Uygulama başladı')
const snmp = require('net-snmp')
const ping = require('ping')
const deviceinfomodel = require('./models/deviceinfo.model')
const devicesmodel = require('./models/devices.model')
const oidsmodel = require('./models/oids.model')

deviceInfo()

// await kullanabilmek için async fonksiyon oluşturduk
async function deviceInfo() {
  // Cihazları bul
  const devices = await devicesmodel.find({})
  logger.info(`Device listesi çekildi. Toplam: ${devices.length}`)

  // Cihazlar içinde dolaş
  devices.map(async d => {

    // Çalışan cihazları tespit edip eğer ulaşılıyorsa işleme devam ediliyor
    // ping.sys.probe(d.ipAddress, async function (isAlive) {
    // if (isAlive) {
    //   console.log(d.ipAddress + ' alive')

    // Bağlantı tarihi oluşturuluyor 2019-10-10T20:20:20.000+03:00
    let dt = new Date()
    datestring = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2) + 'T' +
      ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2) + ':' + ('0' + dt.getSeconds()).slice(-2) + '.000+03:00'
    logger.info(`Cihaz kayıt tarihi: ${datestring} (${d.ipAddress})`)

    // Cihaz için veri girişi yapılıyor daha sonra bu kayda eklemeler yapılacak
    await deviceinfomodel.insertMany({ ipAddress: d.ipAddress, date: datestring })
    logger.info(`Cihaz için info'lar kaydedildi.`)

    // Cihaza ait global ya da özel oid listesi çekiliyor, type != tree
    const oidlist = await oidsmodel.find({ $or: [{ manufacturer: "global" }, { manufacturer: d.manufacturer }], type: { $ne: 'tree' } })
    logger.info(`Cihaz için oidlist çekildi (tree olmayan). Toplam: ${oidlist.length}`)

    // Cihaza ait global ya da özel oid listesi çekiliyor, type = tree
    const oidtreelist = await oidsmodel.find({ $and: [{ manufacturer: d.manufacturer }, { type: 'tree' }] })
    logger.info(`Cihaz için oidlist çekildi (tree olan). Toplam: ${oidtreelist.length}`)

    // getoid fonksiyonu için çekilen oidleri dizi haline getiriyor
    let oidarray = oidlist.map(o => o.oid)

    // Cihazlara snmp bağlantısı başlatılıyor
    let session = snmp.createSession(d.ipAddress, 'public')

    // getoid fonksiyonu veri girişi parametresiyle çağrılıyor - 'insert'
    getoid(oidarray, 'insert')

    // getoid fonksiyonu
    // dizi şeklinde oid ( [1.3.6.1.2.1.1.5.0,1.3.6.1.2.1.1.3.0] ),
    // yapılacak işlemin türü ('insert','update'),
    // 'update' otomatik çağrılıyor ve bu subtree metodunun feedCb fonksiyonu altından bulunan oidin gönderimini sağlıyor
    // eğer update ise güncellenecek oid ('1.3.6.1.2.1.1.3.0')
    function getoid(oids, type, findoid) {

      // session.get veritabanından çekilen ve dizi haline getirilen oidler için cihaza sorgu atıp karşılığındaki değerleri işleyecek
      session.get(oids, async function (error, varbinds) {
        if (error) {
          // console.error(error.toString() + ' : ' + d.ipAddress + ' - ' + d.manufacturer)
          logger.error(`Cihazla snmp bağlantısı kurulurken bir hata oluştu. ${d.ipAddress + ' - ' + d.manufacturer}. Detay: ${error.toString()}`)

          // Cihaz bilgisine erişilebilirlik ekleniyor
          await devicesmodel.findOneAndUpdate({ ipAddress: d.ipAddress }, { $set: { status: 'offline' } })
          deviceinfomodel.findOneAndDelete({
            ipAddress: d.ipAddress, date: datestring
          }, function (err) {
            if (err) {
              logger.error(`Veri çekilemeyen kayıt silinirken bir hata oluştu. ${d.ipAddress}. Detay: ${err.toString()}`)
            }
          })
        } else {

          // Cihaz bilgisine erişilebilirlik ekleniyor
          await devicesmodel.findOneAndUpdate({ ipAddress: d.ipAddress }, { $set: { status: 'online' } })
          for (var i = 0; i < varbinds.length; i++) {
            // for version 1 we can assume all OIDs were successful
            // console.log(varbinds[i].oid + "|" + varbinds[i].value)
            // for version 2c we must check each OID for an error condition
            if (snmp.isVarbindError(varbinds[i]))
              logger.error(`oid'ler çekilirken bir hata oluştu. ${d.ipAddress + ' - ' + d.manufacturer}`)
            // console.error(snmp.varbindError(varbinds[i]))
            else {

              // veri hatasız çekilirse veri girişi yapılacak
              // 'insert' şeklinde gelen veri global ve firmaya ait tekli oidler oluyor, veri girişi yapılacak
              if (type === 'insert') {

                // buraya gelen oidlerin karşılığında veri tabanında kayıtlı açıklamaları almak için oide ait verileri çekiyoruz
                var _oid = await oidlist.find(o => o.oid === varbinds[i].oid)
                logger.info(`Gelen verinin karşılığı oid çekildi. ${_oid && _oid.oid}`)

                // oide ait veritabanına yazılacak diziyi oluşturuyoruz
                let info = [{ oid: varbinds[i].oid, label: _oid.descr, value: varbinds[i].value.toString().trim() }]

                // oluşturulan veri dizisi hangi cihazda işlem yapılıyorsa ona ait kayıt altına yazılıyor
                try {
                  await deviceinfomodel.findOneAndUpdate({
                    ipAddress: d.ipAddress,
                    date: datestring
                  },
                    {
                      $push: { info: info }
                    })
                  logger.info(`Cihaz info (info.json) bilgisi güncellendi. ${d.ipAddress}`)
                } catch (exception) {
                  logger.error(`Cihaz info bilgisi güncellenirken bir hata oluştu. ${d.ipAddress} ${exception.toString()}`)
                }
              }
              // 'update' şeklinde gelen veri firmaya özel olan ve subtree altından gönderilen
              // otomatik oidlerin value anahtarlarının yazılması için oluşturuldu
              // oid: 1.3.6.1.4.1.253.8.53.13.2.1.8.1.20.9
              // label: Black Printed 2 Sided Sheets
              // şeklinde olan yeriye
              // value: 9526 değeri oluşturuluyor
              else if (type === 'update') {

                try {
                  await deviceinfomodel.findOneAndUpdate({
                    ipAddress: d.ipAddress, date: datestring, 'info.oid': findoid
                  },
                    {
                      $set: { 'info.$.value': varbinds[i].value.toString().trim() }
                    })
                  logger.info(`Cihaz info (info.value) bilgisi güncellendi. ${d.ipAddress}`)
                } catch (exception) {
                  logger.error(`Cihaz info bilgisi güncellenirken bir hata oluştu. ${d.ipAddress} ${exception.toString()}`)
                }
              }
            }
          }
        }
      })
    }
    // firmaya özel çekilen oid ağacının içeriğini okuyacak
    oidtreelist.map(oid => {
      // subtree - fonksiyon uzun süre çağrılmayınca buraya düşüyor / işlem tamamlandı
      function doneCb(error) {
        if (error)
          console.error(error.toString())
        else
          console.log(d.ipAddress + ' ayrıntılı kayıtlar güncellendi')
      }
      // subtree - fonksiyon her bulduğu oid için bu fonksiyonu çağırıyor
      async function feedCb(varbinds) {
        for (let i = 0; i < varbinds.length; i++) {
          if (snmp.isVarbindError(varbinds[i]))
            console.error(snmp.varbindError(varbinds[i]))
          else {

            // oide ait veritabanına yazılacak diziyi oluşturuyoruz
            let info = [{ oid: varbinds[i].oid, label: varbinds[i].value.toString().trim() }]

            // oluşturulan veri dizisi hangi cihazda işlem yapılıyorsa ona ait kayıt altına yazılıyor
            try {
              await deviceinfomodel.findOneAndUpdate({ ipAddress: d.ipAddress, date: datestring }, { $push: { info: info } })
              logger.info(`Cihaz info bilgisi güncellendi. ${d.ipAddress}`)
            } catch (exception) {
              logger.error(`Cihaz info bilgisi güncellenirken bir hata oluştu. ${d.ipAddress} ${exception.toString()}`)
            }

            // oid: 1.3.6.1.4.1.253.8.53.13.2.1.8.1.20.9
            // label: Black Printed 2 Sided Sheets
            // şeklinde olan yeriye
            // value: 9526 değeri oluşturmak için bu değerin bulunduğu oidin ne olduğu hesaplanıyor

            // bulunan oid bilgisi dizi halinde değişkene atılıyor
            // 1.3.6.1.4.1.253.8.53.13.2.1.8.1.20.9
            let valueoid = (varbinds[i].oid).split('.')

            // oid altında buna ait değer anahtarının karşılığı olan key dizi halinde değişkene atılıyor
            // 1.3.6.1.4.1.253.8.53.13.2.1.6.1.20
            let suboid = oid.valueoid.split('.')

            // kısa olanın uzunluğu kadar eleman bulunan oid ile değiştiriliyor yani son hali
            // 1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.9
            for (let i = 0; i < suboid.length; i++) {
              valueoid[i] = suboid[i]
            }
            valueoid = valueoid.join('.')

            // yeniden oluşturulan oid'i 'update' ile getoid'e gönderiyoruz.
            // hangi oid kontrol edilecek
            // güncelleme yapılacak
            // ve bu oid anahtarına sahip verinin altına yazılacak
            // bilgisini gönderiyoruz. 
            getoid([valueoid], 'update', varbinds[i].oid)
          }
        }
      }
      // hata durumunda deneme sayısı
      var maxRepetitions = 20

      // oid ağacı altındaki oidleri bulma işlemleri yapılacak
      session.subtree(oid.oid, maxRepetitions, feedCb, doneCb)
    })
    // }
    // // cihaza ulaşılamıyorsa (ping yoksa) yapılacaklar
    // else
    //   console.log(d.ipAddress + ' dead')
    // })
  })
}

setInterval(() => {
  deviceInfo()
}, 30 * 60 * 1000)