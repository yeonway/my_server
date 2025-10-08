// routes/school.js
const express = require("express");
const axios = require("axios");
const router = express.Router();
const Timetable = require('comcigan-parser');

const API_KEY = process.env.NEIS_API_KEY || "50d1ce5590bb4751a26d7da89a5c3632";
const timetableCache = {}; // 시간표 인스턴스를 캐싱할 객체

function today() {
  const d = new Date();
  return d.toISOString().split("T")[0].replace(/-/g, "");
}

// -------------------- 급식 (학교 검색 기능 추가) --------------------
router.get("/meal", async (req, res) => {
  const { schoolName } = req.query;
  if (!schoolName) {
    return res.status(400).json({ error: "학교 이름을 입력해주세요." });
  }

  try {
    // 1. 학교 이름으로 학교 정보(교육청, 학교코드) 조회
    const schoolInfoUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${API_KEY}&Type=json&SCHUL_NM=${encodeURIComponent(schoolName)}`;
    const schoolInfoRes = await axios.get(schoolInfoUrl);

    if (!schoolInfoRes.data.schoolInfo) {
      return res.status(404).json({ error: "학교를 찾을 수 없습니다. 학교 이름을 확인해주세요." });
    }
    const schoolData = schoolInfoRes.data.schoolInfo[1].row[0];
    const ATPT_CODE = schoolData.ATPT_OFCDC_SC_CODE;
    const SCHOOL_CODE = schoolData.SD_SCHUL_CODE;

    // 2. 조회된 정보로 급식 정보 요청
    const mealUrl = `https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=${API_KEY}&Type=json&ATPT_OFCDC_SC_CODE=${ATPT_CODE}&SD_SCHUL_CODE=${SCHOOL_CODE}&MLSV_YMD=${today()}`;
    const { data } = await axios.get(mealUrl);

    if (!data.mealServiceDietInfo) {
      return res.json({ meal: "오늘 급식 정보가 없습니다." });
    }

    const rows = data.mealServiceDietInfo[1].row;
    const meal = rows.map(r => ({
      mealName: r.MMEAL_SC_NM,
      menu: r.DDISH_NM.replace(/<br\/>/g, ", ")
    }));

    res.json(meal);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "급식 정보를 불러오는 중 오류가 발생했습니다." });
  }
});

// -------------------- 시간표 (동적 초기화 및 캐싱) --------------------
router.get("/timetable", async (req, res) => {
  const { schoolName } = req.query;
  if (!schoolName) {
    return res.status(400).json({ error: "학교 이름을 입력해주세요." });
  }

  try {
    // 캐시된 인스턴스가 없으면 새로 생성 및 초기화
    if (!timetableCache[schoolName]) {
      console.log(`[${schoolName}] 새로운 시간표 파서 초기화 시작...`);
      const newTimetable = new Timetable();
      await newTimetable.init({ schoolName });
      timetableCache[schoolName] = newTimetable; // 캐시에 저장
      console.log(`[${schoolName}] 시간표 초기화 완료.`);
    }

    const timetable = timetableCache[schoolName];
    const result = await timetable.getTimetable();
    res.json(result);
  } catch (err) {
    console.error(`[${schoolName}] 시간표 처리 오류:`, err);
    // 캐시에서 실패한 인스턴스 제거
    delete timetableCache[schoolName];
    res.status(500).json({ error: "시간표 정보를 불러오는 중 오류가 발생했습니다. 학교가 컴시간을 사용하는지 확인해주세요." });
  }
});

module.exports = router;
