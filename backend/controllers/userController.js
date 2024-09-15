const DataModel = require("../models/dataModel");
const s3BucketService = require("../services/s3BucketService");

var max_file_size = process.env.MAX_FILE_SIZE
var allowed_for_slug = process.env.ALLOW_FILE_LIMIT

exports.getData = async function (req, res) {
  try {
    const { slug, flag, time } = req.body;
    let data_present;
    if (time) {
      data_present = await _getRequiredDataVersion(slug, time);
    } else if (flag == "allVersion") {
      data_present = await _getAllVersion(slug);
    } else {
      data_present = await _getLatestDataVersion(slug);
    }

    if (data_present) {
      const requiredPayload = {
        _id: data_present._id,
        data: data_present.data,
        unique_name: data_present.unique_name,
        language: data_present.language,
        files: data_present.files,
      };

      if (flag != "allVersion" && data_present.latestDataVersion) {
        requiredPayload.data = data_present.latestDataVersion;
      }
      if (flag == "specific" && data_present.dataVersion) {
        requiredPayload.data = data_present.dataVersion;
      }
      if (flag == "allVersion") {
        requiredPayload.data = data_present.dataVersion;
      }

      res.status(200).json({
        success: true,
        message: "data found",
        result: requiredPayload,
      });
    } else {
      res.status(200).json({
        success: false,
        message: "data not found",
      });
    }
  } catch (e) {
    res.status(500).json({
      success: false,
      message: "internal server error : " + e,
    });
  }
};

exports.saveData = async (req, res) => {
  try {
    const { slug, data } = req.body;
    const latestVersion = await _getLatestDataVersion(slug);
    if (latestVersion?.latestDataVersion?.data == data) {
      return res.status(201).json({
        success: true,
        message: "data save successfully",
      });
    }
    var newData = {
      time: new Date().getTime(),
      data: data,
    };
    const data_present = await DataModel.updateOne(
      { unique_name: slug },
      { $push: { dataVersion: newData } },
      { upsert: true }
    );
    if (data_present) {
      res.status(200).json({
        success: true,
        message: "data save successfully",
        newData: newData,
      });
    }
  } catch (e) {
    res.status(500).json({
      success: false,
      message: "internal server error : " + e,
    });
  }
};

exports.validateFile = async (req, res, next) => {
  try {
    const unique_name = req.headers.slug;
    const fileSize = req.headers.fileSize;
    if (!unique_name) {
      return res.status(400).json({
        success: false,
        massege: "Slug is required",
      });
    } else if ((!fileSize || fileSize > max_file_size) && !unique_name.includes(allowed_for_slug)) {
      return res.status(400).json({
        success: false,
        massege: "File Size must be less then " + max_file_size + " bytes",
      });
    } else {
      next();
    }
  } catch (err) {
    console.error(`Error while validating file: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: `Error uploading file`,
    });
  }
};

exports.saveFileNew = async (req, res, next) => {
  try {
    const unique_name = req.body.slug;
    var fileObject = {
      name: req.file.originalname,
      url: req.file.location,
      key: req.file.key,
      type: req.file.mimetype,
      others: {
        contentType: req.file.contentType,
        encoding: req.file.encoding,
        bucket: req.file.bucket,
        metadata: req.file.metadata,
        etag: req.file.etag,
        acl: req.file.acl
      }
    };
    try {
      const data = await DataModel.updateOne(
        { unique_name: unique_name },
        { $push: { files: fileObject } },
        { upsert: true }
      );
    } catch (e) {
      return res.status(200).json({
        success: true,
        message: `Error uploading file: ${e}`,
      });
    }

    res.status(200).json({
      success: true,
      message: "File successfully saved",
      result: fileObject,
    });
  } catch (err) {
    console.error(`Error uploading file: ${err.message}`);
    return res.status(200).json({
      success: true,
      message: `Error uploading file`,
    });
  }
};

exports.saveFile = async (req, res) => {
  try {
    const base64File = req.body.file;
    const unique_name = req.body.slug;
    const type = req.body.type;

    if (!unique_name) {
      return res.status(404).json({
        success: false,
        massege: "Slug is required",
      });
    }
    const fileName = unique_name + "-" + req.body.fileName;
    let response;
    try {
      response = await s3BucketService.upload(fileName, base64File, type);

      var fileObject = {
        name: fileName,
        url: response.Location,
        key: response.key,
        type: type,
      };
      try {
        const data = await DataModel.updateOne(
          { unique_name: unique_name },
          { $push: { files: fileObject } },
          { upsert: true }
        );
      } catch (e) {
        return res.status(200).json({
          success: true,
          message: `Error uploading file: ${e}`,
        });
      }

      res.status(200).json({
        success: true,
        message: "File successfully saved",
        result: fileObject,
      });
    } catch (err) {
      console.error(`Error uploading file: ${err.message}`);
      return res.status(200).json({
        success: true,
        message: `Error uploading file: ${fileName}`,
      });
    }
  } catch (e) {
    res.status(500).json({
      success: false,
      message: "internal server error : " + e,
    });
  }
};

exports.removeFile = async (req, res) => {
  try {
    const fileObject = req.body.file;
    var fileKey = fileObject.key;
    const unique_name = req.body.slug;
    if (!unique_name) {
      return res.status(404).json({
        success: false,
        massege: "Slug is required",
      });
    }
    let response;
    try {
      response = await s3BucketService.remove(fileKey);
    } catch (err) {
      console.error(`Error removing file : ${err.message}`);
      return res.status(200).json({
        success: true,
        message: `Error removing file in bucket : ${fileKey}`,
      });
    }

    try {
      const data = await DataModel.updateOne(
        { unique_name: unique_name },
        { $pull: { files: { _id: fileObject._id } } }
      );
    } catch (e) {
      return res.status(200).json({
        success: true,
        message: `Error uploading file: ${e}`,
      });
    }

    res.status(200).json({
      success: true,
      message: "File removed successfully",
      file: fileObject,
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: "internal server error : " + e,
    });
  }
};

async function _getLatestDataVersion(slug) {
  try {
    const result = await DataModel.aggregate([
      { $match: { unique_name: slug } },
      { $unwind: "$dataVersion" },
      { $sort: { "dataVersion.time": -1 } },
      {
        $group: {
          _id: "$_id",
          data: { $first: "$data" },
          language: { $first: "$language" },
          unique_name: { $first: "$unique_name" },
          latestDataVersion: { $first: "$dataVersion" },
          files: { $first: "$files" },
        },
      },
    ]);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("Error fetching the latest data version:", error);
    return null;
  }
}
async function _getRequiredDataVersion(slug, time) {
  try {
    const result = await DataModel.aggregate([
      {
        $match: {
          unique_name: slug,
        },
      },
      {
        $unwind: "$dataVersion",
      },
      {
        $match: {
          "dataVersion.time": new Date(time),
        },
      },
    ]);

    return result && result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("Error fetching the latest data version:", error);
    return null;
  }
}

async function _getAllVersion(slug) {
  const pipeline = [
    {
      $match: { unique_name: slug } // Step 1: Match the document
    }, {
      $project: {
        files: 0,
        data: 0
      }
    },
    {
      $project: {
        unique_name: 1,
        language: 1,
        dataVersion: {
          $map: {
            input: { $slice: ["$dataVersion", -30] }, // Get last 5 entries
            as: "version",
            in: {
              time: "$$version.time",
              // Exclude the data field from the dataVersion array
            }
          }
        }
      }
    }
  ];
  // Execute the aggregation pipeline
  data_present = await DataModel.aggregate(pipeline);
  data_present = Array.isArray(data_present) ? data_present[0] : data_present;
  return data_present;
}
 